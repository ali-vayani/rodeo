import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { UserStatus, Role } from '$lib/generated/prisma/client';

export const dashboardRouter = router({
	stats: adminProcedure.query(async ({ ctx }) => {
		const [total, byStatus, byDecision, byRole, recentActivity] = await Promise.all([
			ctx.prisma.user.count(),

			ctx.prisma.user.groupBy({
				by: ['status'],
				_count: { status: true }
			}),

			ctx.prisma.user.groupBy({
				by: ['activeDecision'],
				_count: { activeDecision: true }
			}),

			ctx.prisma.user.findMany({
				select: { roles: true }
			}),

			ctx.prisma.log.findMany({
				take: 20,
				orderBy: { timestamp: 'desc' },
				include: { user: true }
			})
		]);

		// Flatten role counts (users have multiple roles)
		const roleCounts: Partial<Record<Role, number>> = {};
		for (const user of byRole) {
			for (const role of user.roles) {
				roleCounts[role] = (roleCounts[role] ?? 0) + 1;
			}
		}

		const statusCounts: Partial<Record<UserStatus, number>> = {};
		for (const row of byStatus) {
			statusCounts[row.status] = row._count.status;
		}

		const decisionCounts: Partial<Record<string, number>> = {};
		for (const row of byDecision) {
			const key = row.activeDecision ?? 'null';
			decisionCounts[key] = row._count.activeDecision;
		}

		return {
			total,
			byStatus: statusCounts,
			byDecision: decisionCounts,
			byRole: roleCounts,
			recentActivity
		};
	}),

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
