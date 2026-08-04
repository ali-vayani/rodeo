import { z } from 'zod';
import { Role, UserStatus, DecisionStatus, InvitationStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';

export const userRouter = router({
	me: authedProcedure.query(async ({ ctx }) => {
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			include: {
				team: {
					include: {
						members: true,
						invitations: {
							where: { status: InvitationStatus.PENDING },
							include: { user: true }
						}
					}
				},
				invitations: {
					where: { status: InvitationStatus.PENDING },
					include: { team: { include: { members: true } } }
				}
			}
		});
	}),

	list: adminProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(200).default(50),
				search: z.string().optional(),
				roles: z.array(z.nativeEnum(Role)).optional(),
				statuses: z.array(z.nativeEnum(UserStatus)).optional(),
				decisions: z.array(z.nativeEnum(DecisionStatus)).optional(),
				includeNoDecision: z.boolean().optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const { page, pageSize, search, roles, statuses, decisions, includeNoDecision } = input;

			// Build AND conditions so each filter stacks independently
			const conditions: any[] = [];

			if (search) {
				conditions.push({
					OR: [
						{ name: { contains: search, mode: 'insensitive' as const } },
						{ email: { contains: search, mode: 'insensitive' as const } }
					]
				});
			}

			if (roles?.length) conditions.push({ roles: { hasSome: roles } });
			if (statuses?.length) conditions.push({ status: { in: statuses } });

			// Decision filter: support specific statuses AND/OR null (no decision)
			if (decisions !== undefined || includeNoDecision !== undefined) {
				const decisionOr: any[] = [];
				if (decisions?.length) decisionOr.push({ activeDecision: { in: decisions } });
				if (includeNoDecision) decisionOr.push({ activeDecision: null });
				if (decisionOr.length === 1) conditions.push(decisionOr[0]);
				else if (decisionOr.length > 1) conditions.push({ OR: decisionOr });
				// empty decisionOr = all decision filters unchecked = show nothing
				else conditions.push({ uid: 'IMPOSSIBLE_NO_MATCH' });
			}

			const where = conditions.length > 0 ? { AND: conditions } : {};

			const [total, users] = await Promise.all([
				ctx.prisma.user.count({ where }),
				ctx.prisma.user.findMany({
					where,
					skip: (page - 1) * pageSize,
					take: pageSize,
					orderBy: { createdAt: 'desc' }
				})
			]);

			return { users, total, page, pageSize };
		}),

	getById: adminProcedure.input(z.object({ uid: z.string() })).query(async ({ ctx, input }) => {
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: input.uid },
			include: {
				application: { include: { question: true } },
				team: { include: { members: true } },
				scans: { orderBy: { timestamp: 'desc' } }
			}
		});
	}),

	updateRole: adminProcedure
		.input(z.object({ uid: z.string(), roles: z.array(z.nativeEnum(Role)) }))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { roles: input.roles }
			});
		}),

	updateStatus: adminProcedure
		.input(z.object({ uid: z.string(), status: z.nativeEnum(UserStatus) }))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { status: input.status }
			});
		}),

	/**
	 * Manual decision override from /admin/users.
	 *
	 * Intentionally NOT guarded by the admissions review lock — this is the escape
	 * hatch if a claim ever wedges. It does clear the claim, so the applicant stops
	 * showing as "being reviewed" once overridden.
	 */
	updateDecisions: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				pendingDecision: z.nativeEnum(DecisionStatus).nullable(),
				activeDecision: z.nativeEnum(DecisionStatus).nullable()
			})
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.user.update({
				where: { uid: input.uid },
				data: {
					pendingDecision: input.pendingDecision,
					activeDecision: input.activeDecision,
					claimedBy: null,
					claimedAt: null
				}
			});
		}),

	exportCsv: adminProcedure.query(async ({ ctx }) => {
		const users = await ctx.prisma.user.findMany({
			orderBy: { createdAt: 'desc' }
		});

		const header = 'uid,name,email,roles,status,pendingDecision,activeDecision,teamId,createdAt';
		const rows = users.map((u) =>
			[
				u.uid,
				`"${u.name.replace(/"/g, '""')}"`,
				u.email,
				u.roles.join('|'),
				u.status,
				u.pendingDecision ?? '',
				u.activeDecision ?? '',
				u.teamId ?? '',
				u.createdAt.toISOString()
			].join(',')
		);

		return [header, ...rows].join('\n');
	})
});
