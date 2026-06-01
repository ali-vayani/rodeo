import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus, BlacklistType, QuestionType, Role } from '$lib/generated/prisma/client';
import { createTestCaller, hackerUser, appliedHacker, mockSettings } from '../test-utils';

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

describe('application.submit', () => {
	it('sets status to APPLIED on success', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findMany.mockResolvedValue([] as never);
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

	it('auto-sets pendingDecision=REJECTED for blacklisted email', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ id: 'bl-1', type: BlacklistType.EMAIL, value: hackerUser.email, createdAt: new Date() }
		] as never);
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

	it('auto-sets pendingDecision=REJECTED for blacklisted name', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ id: 'bl-2', type: BlacklistType.NAME, value: 'hacker', createdAt: new Date() }
		] as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.submit();

		expect(db.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ pendingDecision: DecisionStatus.REJECTED })
			})
		);
	});

	it('calls sendTemplatedEmail on success when submitTemplate is set', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findMany.mockResolvedValue([] as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.application.submit();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			hackerUser.email,
			mockSettings.submitTemplate,
			expect.objectContaining({ name: hackerUser.name })
		);
	});
});
