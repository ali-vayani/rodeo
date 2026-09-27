import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role } from '$lib/generated/prisma/client';
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

const savedRubrics = [
	{
		id: 'c1',
		role: Role.HACKER,
		title: 'Motivation',
		order: 0,
		levels: [level('c1l1', 'c1', 1, 0), level('c1l2', 'c1', 4, 1)]
	},
	{
		id: 'c2',
		role: Role.JUDGE,
		title: 'Expertise',
		order: 0,
		levels: [level('c2l1', 'c2', 2, 0)]
	}
];

describe('rubric.get', () => {
	it("returns every role's rubric with criteria and levels in display order", async () => {
		const caller = createTestCaller(db, adminUser);
		db.rubricCriterion.findMany.mockResolvedValue(savedRubrics as never);

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
	const snapshot = () =>
		db.rubricCriterion.findMany
			.mockResolvedValueOnce(
				savedRubrics.map((c) => ({
					id: c.id,
					role: c.role,
					levels: c.levels.map((l) => ({ id: l.id }))
				})) as never
			)
			.mockResolvedValueOnce([] as never);

	it('reconciles by id within a role: updates kept rows, deletes removed, creates new', async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		snapshot();
		db.rubricCriterion.create.mockResolvedValue({ id: 'c3-new' } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			rubrics: [
				{
					role: Role.HACKER,
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
						{ title: 'Effort', levels: [{ label: '1', description: '', points: 1 }] }
					]
				}
			]
		});

		expect(db.rubricCriterion.update).toHaveBeenCalledWith({
			where: { id: 'c1' },
			data: { title: 'Motivation (renamed)', order: 0 }
		});
		expect(db.rubricLevel.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1l2'] } } });
		expect(db.rubricLevel.update).toHaveBeenCalledWith({
			where: { id: 'c1l1' },
			data: { label: '1 - Poor', description: 'None', points: 0, order: 0 }
		});
		expect(db.rubricCriterion.create).toHaveBeenCalledWith({
			data: { role: Role.HACKER, title: 'Effort', order: 1 }
		});
	});

	it('leaves roles absent from the payload untouched', async () => {
		// The judge rubric (c2) isn't posted, so it must survive a hacker-only save.
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		snapshot();
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			rubrics: [{ role: Role.HACKER, criteria: [] }]
		});

		const deleted = db.rubricCriterion.deleteMany.mock.calls.flatMap(
			(call) => (call[0]?.where?.id as { in?: string[] } | undefined)?.in ?? []
		);
		expect(deleted).toEqual(['c1']);
	});

	it("treats an id from another role's rubric as a create, not a move", async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		snapshot();
		db.rubricCriterion.create.mockResolvedValue({ id: 'fresh' } as never);
		db.log.create.mockResolvedValue({} as never);

		// c2 exists, but under JUDGE — posting it under HACKER must not update it.
		await caller.rubric.save({
			rubrics: [
				{
					role: Role.HACKER,
					criteria: [
						{ id: 'c2', title: 'Expertise', levels: [{ label: '1', description: '', points: 1 }] },
						{
							id: 'c1',
							title: 'Motivation',
							levels: [{ id: 'c1l1', label: '1', description: '', points: 1 }]
						}
					]
				}
			]
		});

		expect(db.rubricCriterion.update).not.toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'c2' } })
		);
		expect(db.rubricCriterion.create).toHaveBeenCalledWith({
			data: { role: Role.HACKER, title: 'Expertise', order: 0 }
		});
	});

	it('rejects duplicate roles and staff roles', async () => {
		const caller = createTestCaller(db, adminUser);
		const criteria = [{ title: 'X', levels: [{ label: '1', description: '', points: 1 }] }];

		await expect(
			caller.rubric.save({
				rubrics: [
					{ role: Role.HACKER, criteria },
					{ role: Role.HACKER, criteria }
				]
			})
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			caller.rubric.save({ rubrics: [{ role: Role.ADMIN, criteria }] })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("writes one audit entry naming each role's criteria", async () => {
		const caller = createTestCaller(db, adminUser);
		runInTransaction();
		db.rubricCriterion.findMany
			.mockResolvedValueOnce([] as never)
			.mockResolvedValueOnce([] as never);
		db.rubricCriterion.create.mockResolvedValue({ id: 'c-new' } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.rubric.save({
			rubrics: [
				{
					role: Role.MENTOR,
					criteria: [
						{ title: 'Mentoring depth', levels: [{ label: '1', description: '', points: 1 }] }
					]
				}
			]
		});

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.rubric.save',
					metadata: { MENTOR: ['Mentoring depth'] }
				})
			})
		);
	});

	it('rejects a blank title, a level-less criterion, and out-of-range points', async () => {
		const caller = createTestCaller(db, adminUser);
		const save = (criteria: unknown) =>
			caller.rubric.save({
				rubrics: [{ role: Role.HACKER, criteria: criteria as never }]
			});

		await expect(
			save([{ title: '', levels: [{ label: '1', description: '', points: 1 }] }])
		).rejects.toThrow();
		await expect(save([{ title: 'X', levels: [] }])).rejects.toThrow();
		await expect(
			save([{ title: 'X', levels: [{ label: '1', description: '', points: 1001 }] }])
		).rejects.toThrow();
		expect(db.$transaction).not.toHaveBeenCalled();
	});
});
