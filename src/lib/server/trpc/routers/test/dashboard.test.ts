import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockGroupBy } from '../test-utils';
import { APPLICANT_ROLES } from '$lib/admissions/roles';

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
		// groupBy is called three times: byStatus, byDecision, then byRole — the last
		// became a real GROUP BY once a user held exactly one role, replacing a findMany
		// that pulled every row back to be tallied in memory.
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([
				{ status: UserStatus.CREATED, _count: { status: 7 } },
				{ status: UserStatus.APPLIED, _count: { status: 3 } }
			] as never)
			// byDecision now counts with `_all` so the null bucket is a real count, not 0.
			.mockResolvedValueOnce([
				{ activeDecision: DecisionStatus.ACCEPTED, _count: { _all: 2 } },
				{ activeDecision: null, _count: { _all: 8 } }
			] as never)
			.mockResolvedValueOnce([
				{ role: Role.HACKER, _count: { role: 2 } },
				{ role: Role.ORGANIZER, _count: { role: 1 } }
			] as never)
			// Fourth: decision × role, bounded to applicant roles — what the stat cards
			// and their hover breakdowns read from.
			.mockResolvedValueOnce([
				{ activeDecision: DecisionStatus.ACCEPTED, role: Role.HACKER, _count: { _all: 2 } },
				{ activeDecision: null, role: Role.HACKER, _count: { _all: 5 } },
				{ activeDecision: null, role: Role.JUDGE, _count: { _all: 1 } }
			] as never);
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

	describe('applicant stat cards', () => {
		/** Mocks the four groupBys; the fourth is the decision × role cross-tab. */
		function mockStats(applicantRows: unknown[]) {
			db.user.count.mockResolvedValue(0);
			mockGroupBy(db.user.groupBy)
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce(applicantRows as never);
			db.log.findMany.mockResolvedValue([]);
			return createTestCaller(db, adminUser);
		}

		it('splits each decision into a per-role breakdown', async () => {
			const caller = mockStats([
				{ activeDecision: DecisionStatus.ACCEPTED, role: Role.HACKER, _count: { _all: 40 } },
				{ activeDecision: DecisionStatus.ACCEPTED, role: Role.JUDGE, _count: { _all: 5 } },
				{ activeDecision: DecisionStatus.REJECTED, role: Role.HACKER, _count: { _all: 8 } }
			]);

			const { applicants } = await caller.dashboard.stats();

			expect(applicants.accepted.total).toBe(45);
			expect(applicants.accepted.byRole[Role.HACKER]).toBe(40);
			expect(applicants.accepted.byRole[Role.JUDGE]).toBe(5);
			expect(applicants.rejected.total).toBe(8);
			expect(applicants.total).toBe(53);
			expect(applicants.byRole[Role.HACKER]).toBe(48);
		});

		/**
		 * The bug this replaced: the card read `activeDecision === 'PENDING'`, so it
		 * showed the two users carrying the placeholder rather than the 88 nobody had
		 * decided on. Both belong in the same bucket — neither has an outcome.
		 */
		it('counts undecided and the PENDING placeholder together as awaiting', async () => {
			const caller = mockStats([
				{ activeDecision: null, role: Role.HACKER, _count: { _all: 88 } },
				{ activeDecision: DecisionStatus.PENDING, role: Role.HACKER, _count: { _all: 2 } }
			]);

			const { applicants } = await caller.dashboard.stats();

			expect(applicants.awaiting.total).toBe(90);
			expect(applicants.accepted.total).toBe(0);
		});

		it('bounds the query to applicant roles, so staff never land in a bucket', async () => {
			const caller = mockStats([]);

			await caller.dashboard.stats();

			// CREATED is excluded alongside the role bound: `dashboard.funnel` draws the
			// same population, and an account that never submitted is not awaiting a
			// decision. If the two ever disagree the page shows two different applicant
			// counts side by side.
			expect(db.user.groupBy).toHaveBeenNthCalledWith(
				4,
				expect.objectContaining({
					by: ['activeDecision', 'role'],
					where: { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } }
				})
			);
		});
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.dashboard.stats()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
