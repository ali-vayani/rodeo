import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockGroupBy } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const logEntry = {
	id: 'log-1',
	action: 'admissions.release',
	summary: 'Released 3 decisions (3 accepted)',
	timestamp: new Date('2024-01-01T12:00:00Z'),
	actorId: adminUser.uid,
	actorName: adminUser.name,
	actorEmail: adminUser.email,
	targetId: null,
	targetLabel: null,
	metadata: { released: 3 }
};

describe('log.list', () => {
	it('returns paginated entries from the snapshotted actor fields', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(1);
		db.log.findMany.mockResolvedValue([logEntry]);

		const result = await caller.log.list({ page: 1, pageSize: 50 });

		expect(result.entries).toEqual([logEntry]);
		expect(result.total).toBe(1);
		expect(result.page).toBe(1);
		expect(result.pageSize).toBe(50);

		// The actor snapshot is the whole point of the model — a join here would
		// mean history stops naming admins once they're deleted.
		expect(db.log.findMany).toHaveBeenCalledWith(
			expect.not.objectContaining({ include: expect.anything() })
		);
	});

	it('paginates correctly', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(100);
		db.log.findMany.mockResolvedValue([logEntry]);

		const result = await caller.log.list({ page: 3, pageSize: 10 });

		expect(result.page).toBe(3);
		expect(result.pageSize).toBe(10);
		expect(db.log.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
	});

	it('filters by actor and action', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(1);
		db.log.findMany.mockResolvedValue([logEntry]);

		await caller.log.list({ actorId: adminUser.uid, action: 'admissions.release' });

		expect(db.log.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { actorId: adminUser.uid, action: 'admissions.release' }
			})
		);
	});

	it('searches the summary, the actor, and the target together', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(0);
		db.log.findMany.mockResolvedValue([]);

		await caller.log.list({ search: 'sarah' });

		const { where } = db.log.findMany.mock.calls[0][0]!;
		expect(where?.OR).toEqual([
			{ summary: { contains: 'sarah', mode: 'insensitive' } },
			{ actorName: { contains: 'sarah', mode: 'insensitive' } },
			{ actorEmail: { contains: 'sarah', mode: 'insensitive' } },
			{ targetLabel: { contains: 'sarah', mode: 'insensitive' } }
		]);
	});

	it('applies both ends of a date range', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(0);
		db.log.findMany.mockResolvedValue([]);

		const from = new Date('2026-08-01T00:00:00Z');
		const to = new Date('2026-08-31T23:59:59Z');
		await caller.log.list({ from, to });

		const { where } = db.log.findMany.mock.calls[0][0]!;
		expect(where?.timestamp).toEqual({ gte: from, lte: to });
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.log.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('log.actors', () => {
	it('names actors from the snapshot and sorts them alphabetically', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.log.groupBy).mockResolvedValue([
			{ actorId: 'u2', actorName: 'Zoe Nguyen', _count: { _all: 3 } },
			{ actorId: 'u1', actorName: 'Ali Vayani', _count: { _all: 7 } }
		]);

		const result = await caller.log.actors();

		expect(result).toEqual([
			{ actorId: 'u1', name: 'Ali Vayani', count: 7 },
			{ actorId: 'u2', name: 'Zoe Nguyen', count: 3 }
		]);
	});

	it('falls back to a placeholder when the snapshot predates the migration', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.log.groupBy).mockResolvedValue([
			{ actorId: 'u1', actorName: null, _count: { _all: 1 } }
		]);

		const result = await caller.log.actors();

		expect(result[0].name).toBe('Unknown admin');
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.log.actors()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
