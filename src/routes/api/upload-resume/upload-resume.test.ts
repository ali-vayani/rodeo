import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus, QuestionType } from '$lib/generated/prisma/client';
import { hackerUser, appliedHacker } from '$lib/server/trpc/routers/test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/storage', () => ({
	uploadResume: vi.fn().mockResolvedValue('https://cdn.example.com/resumes/hacker-uid/resume.pdf'),
	MAX_RESUME_SIZE: 10 * 1024 * 1024,
	ALLOWED_RESUME_TYPES: [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	]
}));

const { prisma } = await import('$lib/server/db');
const { uploadResume } = await import('$lib/server/storage');
const db = prisma as DeepMockProxy<PrismaClient>;
const { POST } = await import('./+server');

beforeEach(() => {
	mockReset(db);
	vi.mocked(uploadResume).mockResolvedValue('https://cdn.example.com/resumes/hacker-uid/resume.pdf');
});

function makeRequest(fields: Record<string, string | File>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/api/upload-resume', { method: 'POST', body: form });
}

function makeFile(opts: { name?: string; type?: string; size?: number } = {}): File {
	const { name = 'resume.pdf', type = 'application/pdf', size = 1024 } = opts;
	return new File([new Uint8Array(size)], name, { type });
}

function makeEvent(user: typeof hackerUser | null, request: Request) {
	return { request, locals: { user } } as never;
}

/**
 * SvelteKit's `error()` helper throws an `HttpError` rather than returning a
 * Response, so a direct call to the handler rejects instead of resolving.
 * This wrapper normalises both paths into a plain `Response` so tests can
 * check `response.status` without caring which path ran.
 */
async function callPost(event: ReturnType<typeof makeEvent>): Promise<Response> {
	try {
		return await POST(event);
	} catch (err: unknown) {
		// SvelteKit HttpError has .status and .body
		const httpErr = err as { status?: number; body?: { message?: string } };
		if (typeof httpErr?.status === 'number') {
			return new Response(JSON.stringify(httpErr.body ?? {}), { status: httpErr.status });
		}
		// Unhandled error → 500
		const msg = err instanceof Error ? err.message : 'Internal error';
		return new Response(JSON.stringify({ message: msg }), { status: 500 });
	}
}

const fileUploadQuestion = {
	type: QuestionType.FILE_UPLOAD,
	required: false,
	targetRole: []
};

describe('POST /api/upload-resume', () => {
	describe('authentication', () => {
		it('returns 401 when not logged in', async () => {
			const event = makeEvent(null, makeRequest({ file: makeFile(), questionId: 'q-1' }));
			const response = await callPost(event);
			expect(response.status).toBe(401);
		});
	});

	describe('status guards', () => {
		it('returns 400 when the application is already submitted', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(appliedHacker as never);
			const event = makeEvent(
				appliedHacker,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});
	});

	describe('input validation', () => {
		it('returns 400 when no file is provided', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			const event = makeEvent(
				hackerUser,
				makeRequest({ questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});

		it('returns 400 when questionId is missing', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile() })
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});

		it('returns 404 when the question does not exist', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(null as never);
			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'ghost' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(404);
		});

		it('returns 400 when the question is not a FILE_UPLOAD type', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue({
				type: QuestionType.SHORT_TEXT,
				required: false,
				targetRole: []
			} as never);
			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});

		it('returns 400 for a file that is too large', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			// 11 MB exceeds the 10 MB cap
			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile({ size: 11 * 1024 * 1024 }), questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});

		it('returns 400 for a disallowed MIME type', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			const event = makeEvent(
				hackerUser,
				makeRequest({
					file: makeFile({ type: 'image/png', name: 'photo.png' }),
					questionId: 'q-1'
				})
			);
			const response = await callPost(event);
			expect(response.status).toBe(400);
		});
	});

	describe('successful upload', () => {
		it('calls uploadResume with the user id and file', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			db.applicationResponse.upsert.mockResolvedValue({} as never);

			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			await callPost(event);

			expect(uploadResume).toHaveBeenCalledWith(hackerUser.uid, expect.any(File));
		});

		it('upserts the URL into ApplicationResponse', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			db.applicationResponse.upsert.mockResolvedValue({} as never);
			vi.mocked(uploadResume).mockResolvedValue('https://cdn.example.com/resumes/hacker-uid/resume.pdf');

			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			await callPost(event);

			expect(db.applicationResponse.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { userId_questionId: { userId: hackerUser.uid, questionId: 'q-1' } },
					update: { value: 'https://cdn.example.com/resumes/hacker-uid/resume.pdf' },
					create: expect.objectContaining({
						userId: hackerUser.uid,
						questionId: 'q-1',
						value: 'https://cdn.example.com/resumes/hacker-uid/resume.pdf'
					})
				})
			);
		});

		it('returns 200 with the url in the body', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			db.applicationResponse.upsert.mockResolvedValue({} as never);
			vi.mocked(uploadResume).mockResolvedValue('https://cdn.example.com/resumes/hacker-uid/resume.pdf');

			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ url: 'https://cdn.example.com/resumes/hacker-uid/resume.pdf' });
		});
	});

	describe('storage error propagation', () => {
		it('surfaces a storage error as a 500', async () => {
			db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
			db.question.findUnique.mockResolvedValue(fileUploadQuestion as never);
			vi.mocked(uploadResume).mockRejectedValue(new Error('bucket not found'));

			const event = makeEvent(
				hackerUser,
				makeRequest({ file: makeFile(), questionId: 'q-1' })
			);
			const response = await callPost(event);
			expect(response.status).toBeGreaterThanOrEqual(500);
		});
	});
});
