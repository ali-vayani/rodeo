import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

/** Routes the interactive transaction straight at the mock client, same as admissions.test.ts. */
function runInTransaction() {
	db.$transaction.mockImplementation(((arg: unknown) =>
		typeof arg === 'function'
			? (arg as (tx: typeof db) => unknown)(db)
			: Promise.resolve([])) as never);
}

describe('foodGroups.generate — hacker-only scoping', () => {
	it('queries only hackers, regardless of status filter', async () => {
		// Food groups are a hacker-only concept — a confirmed judge, mentor, volunteer, or
		// staff account must never be pulled into the pools this splits, no matter their
		// status. The mock doesn't filter for us, so what's actually asserted is the query
		// shape: `role: Role.HACKER` must be part of the `where` sent to the database.
		runInTransaction();
		db.user.findMany.mockResolvedValue([]);
		db.foodGroup.deleteMany.mockResolvedValue({ count: 0 } as never);

		const caller = createTestCaller(db, adminUser);
		await caller.foodGroups.generate({ dietaryGroupCount: 1, noRestrictionGroupCount: 1 });

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ role: Role.HACKER })
			})
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, { ...adminUser, role: Role.HACKER });
		await expect(
			caller.foodGroups.generate({ dietaryGroupCount: 1, noRestrictionGroupCount: 1 })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('foodGroups.list — hacker-only pool counts', () => {
	it('scopes both pool counts to hackers', async () => {
		db.foodGroup.findMany.mockResolvedValue([]);
		db.user.count.mockResolvedValue(0);

		const caller = createTestCaller(db, adminUser);
		await caller.foodGroups.list();

		// Two `user.count` calls: the dietary-pool count and the total eligible count. Both
		// must carry the same hacker-only scoping, or the displayed numbers wouldn't match
		// who `generate` actually places.
		for (const call of db.user.count.mock.calls) {
			expect(call[0]).toEqual(
				expect.objectContaining({
					where: expect.objectContaining({ role: Role.HACKER })
				})
			);
		}
		expect(db.user.count).toHaveBeenCalledTimes(2);
	});
});
