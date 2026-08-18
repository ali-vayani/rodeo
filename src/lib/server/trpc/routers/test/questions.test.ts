import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, QuestionType } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';
import { APPLICANT_ROLES } from '$lib/admissions/roles';

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
	linkedField: null,
	optionPreset: null
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
	it('requires authentication (no longer public)', async () => {
		// Was publicProcedure — it served every question, incl. staff-audience and
		// regex/linkedField internals, to anyone. Now gated.
		const caller = createTestCaller(db, null);
		await expect(caller.questions.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});

	it('returns applicant-audience questions when no role filter', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.question.findMany.mockResolvedValue([allRolesQuestion, hackerQuestion]);
		const result = await caller.questions.list({});
		expect(result).toHaveLength(2);
		expect(db.question.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					OR: [{ targetRole: { isEmpty: true } }, { targetRole: { hasSome: APPLICANT_ROLES } }]
				}
			})
		);
	});

	it('filters by role when specified', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.question.findMany.mockResolvedValue([allRolesQuestion, hackerQuestion]);
		await caller.questions.list({ role: Role.HACKER });
		expect(db.question.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					OR: [{ targetRole: { isEmpty: true } }, { targetRole: { hasSome: [Role.HACKER] } }]
				}
			})
		);
	});

	it('excludes questions for other roles', async () => {
		const caller = createTestCaller(db, hackerUser);
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

describe('nullable columns round-trip', () => {
	// Regression: `placeholder`/`min`/`max`/`regex`/`linkedField` are nullable
	// columns, so Prisma hands them back as `null`. The application editor loads a
	// question, JSON-round-trips it untouched, and posts it back — but the input
	// schema declared those fields `.optional()`, which in zod rejects `null`. Every
	// save whose payload contained an added or modified question blew up with
	// "expected string, received null" and surfaced as the generic
	// "Failed to save changes. Please try again."
	//
	// `allRolesQuestion` already has exactly the shape Prisma returns.
	const runInTransaction = () =>
		db.$transaction.mockImplementation(((arg: unknown) =>
			typeof arg === 'function'
				? (arg as (tx: typeof db) => unknown)(db)
				: Promise.resolve([])) as never);

	it('questions.change accepts null on modified and added questions', async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		db.question.findMany.mockResolvedValue([]);

		const { id: _id, ...addedQuestion } = allRolesQuestion;

		await expect(
			caller.questions.change({
				deleted: [],
				modified: [allRolesQuestion],
				added: [addedQuestion],
				reordered: []
			})
		).resolves.toEqual({ success: true });

		// Null has to survive all the way to Prisma — these columns are nullable and
		// `null` is what clears them on both create and update.
		expect(db.question.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'q-all' },
				data: expect.objectContaining({
					placeholder: null,
					min: null,
					max: null,
					regex: null,
					linkedField: null
				})
			})
		);
		expect(db.question.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					placeholder: null,
					min: null,
					max: null,
					regex: null,
					linkedField: null
				})
			})
		);
	});

	it('questions.create accepts null on the nullable fields', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.create.mockResolvedValue(allRolesQuestion);

		const { id: _id, ...addedQuestion } = allRolesQuestion;
		await expect(caller.questions.create(addedQuestion)).resolves.toEqual(allRolesQuestion);
	});

	it('questions.update accepts null on the nullable fields', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.findUniqueOrThrow.mockResolvedValue(allRolesQuestion);
		db.question.update.mockResolvedValue(allRolesQuestion);

		await expect(caller.questions.update(allRolesQuestion)).resolves.toEqual(allRolesQuestion);
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

describe('linkedField is an enum, not free text', () => {
	// It was `z.string().nullish()`, so anything parsed. The value is used as a computed
	// key into a `User` update via `LINKED_FIELD_COLUMN`, and the allowlist was not
	// consulted until read time — so `linkedField: 'univeristy'` saved without complaint
	// and produced a question that wrote nowhere, with nothing anywhere saying so.
	it('accepts a real linked field', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.create.mockResolvedValue(hackerQuestion);
		await caller.questions.create({ ...questionInput, linkedField: 'UNIVERSITY' });
		expect(db.question.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ linkedField: 'UNIVERSITY' }) })
		);
	});

	it('rejects a misspelled one instead of storing it', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(
			caller.questions.create({ ...questionInput, linkedField: 'univeristy' } as never)
		).rejects.toThrow();
		expect(db.question.create).not.toHaveBeenCalled();
	});

	it('rejects the old lowercase spelling, which no longer names anything', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(
			caller.questions.create({ ...questionInput, linkedField: 'university' } as never)
		).rejects.toThrow();
	});

	it('still accepts null, which is how a question is unlinked', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.create.mockResolvedValue(hackerQuestion);
		await caller.questions.create({ ...questionInput, linkedField: null });
		expect(db.question.create).toHaveBeenCalled();
	});

	it('accepts an option preset and rejects one that does not exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.create.mockResolvedValue(hackerQuestion);
		await caller.questions.create({
			...questionInput,
			type: QuestionType.DROPDOWN,
			optionPreset: 'UNIVERSITIES_NA'
		});
		expect(db.question.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ optionPreset: 'UNIVERSITIES_NA' })
			})
		);

		await expect(
			caller.questions.create({ ...questionInput, optionPreset: 'HIGH_SCHOOLS' } as never)
		).rejects.toThrow();
	});
});
