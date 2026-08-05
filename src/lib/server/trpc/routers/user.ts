import { z } from 'zod';
import { Role, UserStatus, DecisionStatus, InvitationStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { buildRecipientWhere, recipientFilterSchema } from '$lib/server/recipients';
import { logAction, listOrNone, valueOrNone } from '$lib/server/log';

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
			recipientFilterSchema.extend({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(200).default(50)
			})
		)
		.query(async ({ ctx, input }) => {
			const { page, pageSize, ...filters } = input;

			// Shared with email.sendCustom / previewRecipients so the count an admin
			// sees and the set that actually gets mailed can never diverge.
			const where = buildRecipientWhere(filters);

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
			// Read first so the audit entry can record what the roles *were*. "Ali
			// changed Sarah's roles to HACKER" answers half the question an audit gets
			// opened to answer; the other half is what it changed from.
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { name: true, roles: true }
			});

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { roles: input.roles }
			});

			await logAction(ctx, {
				action: 'user.roles.update',
				summary: `Changed ${user.name}'s roles to ${listOrNone(input.roles)}`,
				target: { id: user.uid, label: user.name },
				metadata: { from: before.roles, to: input.roles }
			});

			return user;
		}),

	updateStatus: adminProcedure
		.input(z.object({ uid: z.string(), status: z.nativeEnum(UserStatus) }))
		.mutation(async ({ ctx, input }) => {
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { status: true }
			});

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { status: input.status }
			});

			await logAction(ctx, {
				action: 'user.status.update',
				summary: `Changed ${user.name}'s status to ${input.status}`,
				target: { id: user.uid, label: user.name },
				metadata: { from: before.status, to: input.status }
			});

			return user;
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
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { pendingDecision: true, activeDecision: true }
			});

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: {
					pendingDecision: input.pendingDecision,
					activeDecision: input.activeDecision,
					claimedBy: null,
					claimedAt: null
				}
			});

			// Logged as an override rather than a decision: this path bypasses the
			// review lock and the release step, so it is exactly the kind of edit
			// someone will later want to find in the trail.
			await logAction(ctx, {
				action: 'user.decision.override',
				summary:
					`Overrode ${user.name}'s decision — pending ${valueOrNone(input.pendingDecision)}, ` +
					`active ${valueOrNone(input.activeDecision)}`,
				target: { id: user.uid, label: user.name },
				metadata: {
					pendingFrom: before.pendingDecision,
					pendingTo: input.pendingDecision,
					activeFrom: before.activeDecision,
					activeTo: input.activeDecision
				}
			});

			return user;
		}),

	exportCsv: adminProcedure.query(async ({ ctx }) => {
		const users = await ctx.prisma.user.findMany({
			orderBy: { createdAt: 'desc' }
		});

		// A query, but still logged: this is the one call that hands an admin every
		// applicant's name and email in a file, and "who pulled the list" is a
		// question the trail should be able to answer.
		await logAction(ctx, {
			action: 'user.export',
			summary: `Exported the user list (${users.length} users)`,
			metadata: { count: users.length }
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
