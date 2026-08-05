import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockGroupBy } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

describe('dashboard.stats', () => {
	it('returns total, byStatus, byDecision, byRole counts and recent activity', async () => {
		const caller = createTestCaller(db, adminUser);

		db.user.count.mockResolvedValue(10);
		// groupBy is called twice: first for byStatus, then for byDecision
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([
				{ status: UserStatus.CREATED, _count: { status: 7 } },
				{ status: UserStatus.APPLIED, _count: { status: 3 } }
			] as never)
			.mockResolvedValueOnce([
				{ activeDecision: DecisionStatus.ACCEPTED, _count: { activeDecision: 2 } },
				{ activeDecision: null, _count: { activeDecision: 8 } }
			] as never);
		db.user.findMany.mockResolvedValue([
			{ roles: [Role.HACKER] } as never,
			{ roles: [Role.HACKER, Role.ORGANIZER] } as never
		]);
		db.log.findMany.mockResolvedValue([]);

		const result = await caller.dashboard.stats();

		expect(result.total).toBe(10);
		expect(result.byStatus[UserStatus.CREATED]).toBe(7);
		expect(result.byStatus[UserStatus.APPLIED]).toBe(3);
		expect(result.byDecision[DecisionStatus.ACCEPTED]).toBe(2);
		expect(result.byDecision['null']).toBe(8);
		expect(result.byRole[Role.HACKER]).toBe(2);
		expect(result.byRole[Role.ORGANIZER]).toBe(1);
		expect(result.recentActivity).toEqual([]);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.dashboard.stats()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
