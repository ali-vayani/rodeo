import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const logEntry = {
	id: 'log-1',
	action: 'Released decisions for 3 users',
	timestamp: new Date('2024-01-01T12:00:00Z'),
	userId: adminUser.uid,
	user: adminUser
};

describe('log.list', () => {
	it('returns paginated entries with user info', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(1);
		db.log.findMany.mockResolvedValue([logEntry]);

		const result = await caller.log.list({ page: 1, pageSize: 50 });

		expect(result.entries).toEqual([logEntry]);
		expect(result.total).toBe(1);
		expect(result.page).toBe(1);
		expect(result.pageSize).toBe(50);
		expect(db.log.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ include: { user: true } })
		);
	});

	it('paginates correctly', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.count.mockResolvedValue(100);
		db.log.findMany.mockResolvedValue([logEntry]);

		const result = await caller.log.list({ page: 3, pageSize: 10 });

		expect(result.page).toBe(3);
		expect(result.pageSize).toBe(10);
		expect(db.log.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 20, take: 10 })
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.log.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
