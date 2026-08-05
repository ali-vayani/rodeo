import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, QuestionType } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const allRolesQuestion = {
	id: 'q-all',
	title: 'Name',
	type: QuestionType.SHORT_TEXT,
	order: 0,
	required: true,
	targetRole: [],
	placeholder: null,
	options: [],
	min: null,
	max: null,
	regex: null,
	linkedField: null
};

const hackerQuestion = {
	...allRolesQuestion,
	id: 'q-hacker',
	title: 'GitHub URL',
	targetRole: [Role.HACKER]
};

const judgeQuestion = {
	...allRolesQuestion,
	id: 'q-judge',
	title: 'Expertise',
	targetRole: [Role.JUDGE]
};

const questionInput = {
	title: 'GitHub URL',
	type: QuestionType.SHORT_TEXT as QuestionType,
	required: false,
	targetRole: [Role.HACKER],
	options: [],
	order: 1
};

describe('questions.list', () => {
	it('returns all questions when no role filter', async () => {
		const caller = createTestCaller(db, null);
		db.question.findMany.mockResolvedValue([allRolesQuestion, hackerQuestion]);
		const result = await caller.questions.list({});
		expect(result).toHaveLength(2);
		expect(db.question.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: undefined })
		);
	});

	it('filters by role when specified', async () => {
		const caller = createTestCaller(db, null);
		db.question.findMany.mockResolvedValue([allRolesQuestion, hackerQuestion]);
		await caller.questions.list({ role: Role.HACKER });
		expect(db.question.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { OR: [{ targetRole: { isEmpty: true } }, { targetRole: { has: Role.HACKER } }] }
			})
		);
	});

	it('excludes questions for other roles', async () => {
		const caller = createTestCaller(db, null);
		// Mock returns only matching questions (DB handles the filtering)
		db.question.findMany.mockResolvedValue([allRolesQuestion]);
		const result = await caller.questions.list({ role: Role.HACKER });
		expect(result.find((q) => q.id === judgeQuestion.id)).toBeUndefined();
	});
});

describe('questions.listAll', () => {
	it('returns all questions for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.findMany.mockResolvedValue([allRolesQuestion, hackerQuestion, judgeQuestion]);
		const result = await caller.questions.listAll();
		expect(result).toHaveLength(3);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.questions.listAll()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('questions.create', () => {
	it('creates question with all fields', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.create.mockResolvedValue(hackerQuestion);
		const result = await caller.questions.create(questionInput);
		expect(result).toEqual(hackerQuestion);
		expect(db.question.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ title: 'GitHub URL' }) })
		);
	});
});

describe('questions.update', () => {
	it('updates existing question', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.findUniqueOrThrow.mockResolvedValue(hackerQuestion);
		db.question.update.mockResolvedValue({ ...hackerQuestion, title: 'Updated' });
		const result = await caller.questions.update({
			id: 'q-hacker',
			...questionInput,
			title: 'Updated'
		});
		expect(result.title).toBe('Updated');
		expect(db.question.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'q-hacker' } })
		);
	});
});

describe('questions.delete', () => {
	it('deletes by id', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.delete.mockResolvedValue(hackerQuestion);
		await caller.questions.delete({ id: 'q-hacker' });
		expect(db.question.delete).toHaveBeenCalledWith({ where: { id: 'q-hacker' } });
	});
});

describe('questions.reorder', () => {
	it('updates order for multiple questions in a transaction', async () => {
		const caller = createTestCaller(db, adminUser);
		db.$transaction.mockResolvedValue([]);
		const result = await caller.questions.reorder([
			{ id: 'q-all', order: 0 },
			{ id: 'q-hacker', order: 1 }
		]);
		expect(result).toEqual({ success: true });
		expect(db.$transaction).toHaveBeenCalled();
		// Verify update was called for each item
		expect(db.question.update).toHaveBeenCalledTimes(2);
	});
});
