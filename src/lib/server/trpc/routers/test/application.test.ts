import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus, QuestionType, Role } from '$lib/generated/prisma/client';
import { createTestCaller, hackerUser, appliedHacker, acceptedHacker, mockSettings } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendTemplatedEmail } = await import('$lib/server/email');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendTemplatedEmail).mockClear();
});

const response = {
	id: 'resp-1',
	userId: hackerUser.uid,
	questionId: 'q-1',
	value: 'My answer',
	createdAt: new Date('2024-01-01'),
	question: {
		id: 'q-1',
		title: 'Name',
		type: QuestionType.SHORT_TEXT,
		order: 0,
		required: true,
		targetRole: [],
		placeholder: null,
		options: [],
		min: null,
		max: null,
		regex: null
	}
};

const requiredQuestion = {
	id: 'q-1',
	title: 'Name',
	type: QuestionType.SHORT_TEXT,
	order: 0,
	required: true,
	targetRole: [] as Role[],
	placeholder: null,
	options: [] as string[],
	min: null,
	max: null,
	regex: null
};

describe('application.getMyResponses', () => {
	it('returns current user responses with questions', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.applicationResponse.findMany.mockResolvedValue([response] as never);
		const result = await caller.application.getMyResponses();
		expect(result).toEqual([response]);
		expect(db.applicationResponse.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId: hackerUser.uid },
				include: { question: true }
			})
		);
	});

	it('throws UNAUTHORIZED when not logged in', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.application.getMyResponses()).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});

describe('application.save', () => {
	it('upserts on userId+questionId key', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.applicationResponse.upsert.mockResolvedValue(response as never);

		await caller.application.save({ questionId: 'q-1', value: 'My answer' });

		expect(db.applicationResponse.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId_questionId: { userId: hackerUser.uid, questionId: 'q-1' } },
				update: { value: 'My answer' },
				create: { userId: hackerUser.uid, questionId: 'q-1', value: 'My answer' }
			})
		);
	});
});

describe('application.rsvp', () => {
	it('sends the confirm template on success', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CONFIRMED
		} as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.application.rsvp();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			acceptedHacker.email,
			{ subject: mockSettings.confirmSubject, body: mockSettings.confirmTemplate },
			expect.objectContaining({ name: acceptedHacker.name })
		);
	});

	it('still confirms when the email send fails', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CONFIRMED
		} as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		vi.mocked(sendTemplatedEmail).mockRejectedValueOnce(new Error('smtp down'));

		const result = await caller.application.rsvp();

		expect(result.status).toBe(UserStatus.CONFIRMED);
	});
});

describe('application.rsvpDecline', () => {
	it('sends the decline template on success', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.application.rsvpDecline();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			acceptedHacker.email,
			{ subject: mockSettings.declineSubject, body: mockSettings.declineTemplate },
			expect.objectContaining({ name: acceptedHacker.name })
		);
	});

	it('sends nothing when no settings row exists', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.rsvpDecline();

		expect(sendTemplatedEmail).not.toHaveBeenCalled();
	});
});

describe('application.submit', () => {
	it('sets status to APPLIED on success', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(null);

		const result = await caller.application.submit();
		expect(result.status).toBe(UserStatus.APPLIED);
	});

	it('throws BAD_REQUEST if already submitted', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(appliedHacker as never);

		await expect(caller.application.submit()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('throws BAD_REQUEST if required questions are unanswered', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([requiredQuestion] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Name')
		});
	});

	it('auto-sets pendingDecision=REJECTED for a blacklisted email', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue({ id: 'bl-1' } as never);
		db.user.update.mockResolvedValue({
			...hackerUser,
			status: UserStatus.APPLIED,
			pendingDecision: DecisionStatus.REJECTED
		} as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.submit();

		expect(db.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ pendingDecision: DecisionStatus.REJECTED })
			})
		);
	});

	it('looks the email up in its normalized form', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			email: '  Hacker@Example.COM '
		} as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.submit();

		expect(db.blacklist.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { email: 'hacker@example.com' } })
		);
	});

	it('does not auto-reject on a name match, which only flags at review time', async () => {
		// A blacklisted name is matched tolerantly enough to catch misspellings, so it must
		// never reach a decision on its own -- `admissions.list` surfaces it to a human.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.submit();

		const updateArg = db.user.update.mock.calls[0]?.[0];
		expect(updateArg?.data).not.toHaveProperty('pendingDecision');
	});

	it('calls sendTemplatedEmail on success when submitTemplate is set', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.application.submit();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			hackerUser.email,
			{ subject: mockSettings.submitSubject, body: mockSettings.submitTemplate },
			expect.objectContaining({ name: hackerUser.name })
		);
	});
});
