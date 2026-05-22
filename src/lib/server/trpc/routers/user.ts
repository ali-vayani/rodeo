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
				decisions: z.array(z.nativeEnum(DecisionStatus)).optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const { page, pageSize, search, roles, statuses, decisions } = input;

			const where = {
				...(search && {
					OR: [
						{ name: { contains: search, mode: 'insensitive' as const } },
						{ email: { contains: search, mode: 'insensitive' as const } }
					]
				}),
				...(roles?.length && { roles: { hasSome: roles } }),
				...(statuses?.length && { status: { in: statuses } }),
				...(decisions?.length && { activeDecision: { in: decisions } })
			};

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

	getById: adminProcedure
		.input(z.object({ uid: z.string() }))
		.query(async ({ ctx, input }) => {
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
