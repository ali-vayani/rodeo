import { z } from 'zod';
import { router, adminProcedure, portalProcedure } from '../init';
import { isAdmin } from '$lib/auth/permissions';
import { UserStatus, Role } from '$lib/generated/prisma/client';

export const dashboardRouter = router({
	/**
	 * Organizers get the aggregates — counts and charts name nobody — but not
	 * `recentActivity`, which is a log of named users. It comes back null for them
	 * rather than being dropped, so the shape stays the same for every caller and the
	 * dashboard can just check for it.
	 */
	stats: portalProcedure.query(async ({ ctx }) => {
		const showActivity = isAdmin(ctx.user.role);
		const [total, byStatus, byDecision, byRole, recentActivity] = await Promise.all([
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

		return {
			total,
			byStatus: statusCounts,
			byDecision: decisionCounts,
			byRole: roleCounts,
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
