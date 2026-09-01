import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

/** Routes interactive transactions straight at the mock client. */
const runInTransaction = () =>
	db.$transaction.mockImplementation(((arg: unknown) =>
		typeof arg === 'function'
			? (arg as (tx: typeof db) => unknown)(db)
			: Promise.resolve([])) as never);

const level = (id: string, criterionId: string, points: number, order = 0) => ({
	id,
	criterionId,
	label: `${points} pts`,
	description: '',
	points,
	order
});

const savedRubric = [
	{
		id: 'c1',
		title: 'Motivation',
		order: 0,
		levels: [level('c1l1', 'c1', 1, 0), level('c1l2', 'c1', 4, 1)]
	},
	{
		id: 'c2',
		title: 'Project',
		order: 1,
		levels: [level('c2l1', 'c2', 2, 0)]
	}
];

describe('rubric.get', () => {
	it('returns the rubric with criteria and levels in display order', async () => {
		const caller = createTestCaller(db, adminUser);
		db.rubricCriterion.findMany.mockResolvedValue(savedRubric as never);

		const result = await caller.rubric.get();

		expect(result).toHaveLength(2);
		expect(db.rubricCriterion.findMany).toHaveBeenCalledWith({
			orderBy: { order: 'asc' },
			include: { levels: { orderBy: { order: 'asc' } } }
		});
	});

	it('refuses non-admins', async () => {
		await expect(createTestCaller(db, hackerUser).rubric.get()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('rubric.save', () => {
	it('reconciles by id: updates kept rows, deletes removed ones, creates new ones', async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		// First call is the reconciliation snapshot, second the returned fresh read.
		db.rubricCriterion.findMany
			.mockResolvedValueOnce(
				savedRubric.map((c) => ({
					id: c.id,
					levels: c.levels.map((l) => ({ id: l.id }))
				})) as never
			)
			.mockResolvedValueOnce([] as never);
		db.rubricCriterion.create.mockResolvedValue({ id: 'c3-new' } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			criteria: [
				{
					id: 'c1',
					title: 'Motivation (renamed)',
					// Keeps l1 with new points, drops l2, adds a level.
					levels: [
						{ id: 'c1l1', label: '1 - Poor', description: 'None', points: 0 },
						{ label: '2 - Great', description: 'Specific', points: 5 }
					]
				},
				// c2 is absent → deleted. A brand-new criterion follows.
				{ title: 'Effort', levels: [{ label: '1', description: '', points: 1 }] }
			]
		});

		expect(db.rubricCriterion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c2'] } } });
		expect(db.rubricCriterion.update).toHaveBeenCalledWith({
			where: { id: 'c1' },
			data: { title: 'Motivation (renamed)', order: 0 }
		});
		expect(db.rubricLevel.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1l2'] } } });
		expect(db.rubricLevel.update).toHaveBeenCalledWith({
			where: { id: 'c1l1' },
			data: { label: '1 - Poor', description: 'None', points: 0, order: 0 }
		});
		expect(db.rubricLevel.create).toHaveBeenCalledWith({
			data: { label: '2 - Great', description: 'Specific', points: 5, order: 1, criterionId: 'c1' }
		});
		expect(db.rubricCriterion.create).toHaveBeenCalledWith({
			data: { title: 'Effort', order: 1 }
		});
	});

	it('treats an unknown posted id as a create, not a blind update', async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		db.rubricCriterion.findMany
			.mockResolvedValueOnce([] as never)
			.mockResolvedValueOnce([] as never);
		db.rubricCriterion.create.mockResolvedValue({ id: 'fresh' } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			criteria: [
				{
					id: 'forged-id',
					title: 'Criterion',
					levels: [{ id: 'forged-level', label: '1', description: '', points: 1 }]
				}
			]
		});

		expect(db.rubricCriterion.update).not.toHaveBeenCalled();
		expect(db.rubricLevel.update).not.toHaveBeenCalled();
		expect(db.rubricCriterion.create).toHaveBeenCalled();
		expect(db.rubricLevel.create).toHaveBeenCalledWith({
			data: { label: '1', description: '', points: 1, order: 0, criterionId: 'fresh' }
		});
	});

	it('writes one audit entry naming the criteria', async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		db.rubricCriterion.findMany
			.mockResolvedValueOnce([] as never)
			.mockResolvedValueOnce([] as never);
		db.rubricCriterion.create.mockResolvedValue({ id: 'c-new' } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			criteria: [{ title: 'Motivation', levels: [{ label: '1', description: '', points: 1 }] }]
		});

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.rubric.save',
					metadata: { criteria: ['Motivation'] }
				})
			})
		);
	});

	it('rejects a blank title, a level-less criterion, and out-of-range points', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(
			caller.rubric.save({
				criteria: [{ title: '', levels: [{ label: '1', description: '', points: 1 }] }]
			})
		).rejects.toThrow();
		await expect(caller.rubric.save({ criteria: [{ title: 'X', levels: [] }] })).rejects.toThrow();
		await expect(
			caller.rubric.save({
				criteria: [{ title: 'X', levels: [{ label: '1', description: '', points: 1001 }] }]
			})
		).rejects.toThrow();
		expect(db.$transaction).not.toHaveBeenCalled();
	});
});
