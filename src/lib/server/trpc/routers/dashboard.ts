import { z } from 'zod';
import { router, adminProcedure, portalProcedure } from '../init';
import { isAdmin } from '$lib/auth/permissions';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { UserStatus, Role, DecisionStatus } from '$lib/generated/prisma/client';

/** A count with the role split behind it, for the stat cards' hover breakdown. */
export interface RoleTally {
	total: number;
	byRole: Partial<Record<Role, number>>;
}

function emptyTally(): RoleTally {
	return { total: 0, byRole: {} };
}

export const dashboardRouter = router({
	/**
	 * Organizers get the aggregates — counts and charts name nobody — but not
	 * `recentActivity`, which is a log of named users. It comes back null for them
	 * rather than being dropped, so the shape stays the same for every caller and the
	 * dashboard can just check for it.
	 */
	stats: portalProcedure.query(async ({ ctx }) => {
		const showActivity = isAdmin(ctx.user.role);
		const [total, byStatus, byDecision, byRole, applicantRows, recentActivity] = await Promise.all([
			ctx.prisma.user.count(),

			ctx.prisma.user.groupBy({
				by: ['status'],
				_count: { status: true }
			}),

			// `_all`, not `_count: { activeDecision: true }`: a per-field count ignores nulls,
			// so the "no decision yet" bucket would always read 0 no matter how many are
			// undecided.
			ctx.prisma.user.groupBy({
				by: ['activeDecision'],
				_count: { _all: true }
			}),

			// A real `groupBy` now that a user holds one role. This used to select every
			// user's role array and tally it in memory, because a user counted once per
			// role they held and no SQL aggregate expresses that. One role each makes the
			// count a plain GROUP BY, so the whole table stops crossing the wire on every
			// dashboard load.
			ctx.prisma.user.groupBy({
				by: ['role'],
				_count: { role: true }
			}),

			// Decision × role, bounded to the people who actually go through admissions.
			// The `byDecision` tally above counts every user, which puts 60-odd staff
			// accounts — who never apply and never hold a decision — into its null
			// bucket. The stat cards read from this instead, so "Accepted" and
			// "Awaiting" describe applicants rather than the whole table, and the role
			// split each card shows on hover comes off the same rows as its number.
			ctx.prisma.user.groupBy({
				by: ['activeDecision', 'role'],
				where: { role: { in: APPLICANT_ROLES } },
				_count: { _all: true }
			}),

			// No `include: { actor: true }`: the feed renders `actorName`, which is
			// snapshotted on the row precisely so it doesn't need the join.
			showActivity
				? ctx.prisma.log.findMany({
						take: 20,
						orderBy: { timestamp: 'desc' }
					})
				: null
		]);

		const roleCounts: Partial<Record<Role, number>> = {};
		for (const row of byRole) {
			roleCounts[row.role] = row._count.role;
		}

		const statusCounts: Partial<Record<UserStatus, number>> = {};
		for (const row of byStatus) {
			statusCounts[row.status] = row._count.status;
		}

		const decisionCounts: Partial<Record<string, number>> = {};
		for (const row of byDecision) {
			const key = row.activeDecision ?? 'null';
			decisionCounts[key] = row._count._all;
		}

		// One pass over the decision × role rows fills every stat card and its hover
		// breakdown. `awaiting` collects both a null activeDecision and the PENDING
		// placeholder: PENDING is a starting state rather than an outcome, so a user
		// carrying it has not been decided either way.
		const applicants = {
			total: 0,
			accepted: emptyTally(),
			rejected: emptyTally(),
			waitlisted: emptyTally(),
			awaiting: emptyTally(),
			byRole: {} as Partial<Record<Role, number>>
		};

		const TALLY_FOR: Record<string, keyof typeof applicants> = {
			[DecisionStatus.ACCEPTED]: 'accepted',
			[DecisionStatus.REJECTED]: 'rejected',
			[DecisionStatus.WAITLISTED]: 'waitlisted'
		};

		for (const row of applicantRows) {
			const count = row._count._all;
			const key = row.activeDecision ? (TALLY_FOR[row.activeDecision] ?? 'awaiting') : 'awaiting';
			const tally = applicants[key] as RoleTally;

			tally.total += count;
			tally.byRole[row.role] = (tally.byRole[row.role] ?? 0) + count;
			applicants.total += count;
			applicants.byRole[row.role] = (applicants.byRole[row.role] ?? 0) + count;
		}

		return {
			total,
			byStatus: statusCounts,
			byDecision: decisionCounts,
			byRole: roleCounts,
			applicants,
			recentActivity
		};
	}),

	/** Named applicants — admin only. The dashboard skips this call for organizers. */
	recentApplicants: adminProcedure
		.input(z.object({ amount: z.number().int().min(1).max(100).default(10) }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.user.findMany({
				take: input.amount,
				orderBy: { createdAt: 'desc' },
				where: { status: { not: UserStatus.CREATED } }
			});
		})
});
