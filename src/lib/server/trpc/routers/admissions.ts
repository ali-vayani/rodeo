import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { createLog } from '$lib/server/log';
import { sendTemplatedEmail } from '$lib/server/email';

export const admissionsRouter = router({
	/**
	 * list all users with optional filters
	 * TODO: add more filters like status, team, group, etc.
	 * 
	 * @param roles - filter by roles
	 * @param decision - filter by decision (pending & active)
	 * @param search - search by name or email
	 */
	list: adminProcedure
		.input(
			z.object({
				roles: z.array(z.nativeEnum(Role)).optional(),
				decision: z.nativeEnum(DecisionStatus).optional(),
				noDecision: z.boolean().optional(),
				search: z.string().optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const { roles, decision, noDecision, search } = input;

			return ctx.prisma.user.findMany({
				where: {
					...(roles?.length && { roles: { hasSome: roles } }),
					...(noDecision && { pendingDecision: null, activeDecision: null }),
					...(decision !== undefined && {	OR: [
							{ pendingDecision: decision },
							{ activeDecision: decision }
						]
					}),
					...(search && {
						OR: [
							{ name: { contains: search, mode: 'insensitive' as const } },
							{ email: { contains: search, mode: 'insensitive' as const } }
						]
					})
				},
				include: {
					application: { include: { question: true } }
				},
				orderBy: { createdAt: 'desc' }
			});
		}),

	/**
	 * set a decision for a user
	 * 
	 * @param uid - the user's uid
	 * @param decision - the decision to set
	 */
	setDecision: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				decision: z.nativeEnum(DecisionStatus)
			})
		)
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { pendingDecision: input.decision }
			});
		}),

	/**
	 * Release pending decisions to active decisions and notify by email.
	 * @param uids - If non-empty, only those users are promoted and emailed (each must have a pending decision). Omitted or empty: all users with a pending decision.
	 */
	release: adminProcedure
		.input(
			z.object({
				uids: z.array(z.string()).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
		const restrictToUids = Boolean(input.uids?.length);

		const users = await ctx.prisma.user.findMany({
			where: {
				pendingDecision: { not: null },
				...(restrictToUids && { uid: { in: input.uids } })
			}
		});

		if (users.length === 0) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: restrictToUids
					? 'No pending decisions to release for the selected users.'
					: 'No pending decisions to release.'
			});
		}

		// Fetch settings for email templates
		const settings = await ctx.prisma.settings.findFirst();

		// Apply all pending decisions to active decisions in a transaction
		await ctx.prisma.$transaction(
			users.map((u) =>
				ctx.prisma.user.update({
					where: { uid: u.uid },
					data: {
						activeDecision: u.pendingDecision,
						pendingDecision: null
					}
				})
			)
		);

		// Send emails per decision type (fire-and-forget in dev)
		if (settings) {
			const templateMap: Record<string, string> = {
				[DecisionStatus.ACCEPTED]: settings.acceptTemplate,
				[DecisionStatus.REJECTED]: settings.rejectTemplate,
				[DecisionStatus.WAITLISTED]: settings.waitlistTemplate,
				[DecisionStatus.PENDING]: ''
			};

			await Promise.allSettled(
				users
					.filter((u) => u.pendingDecision && templateMap[u.pendingDecision])
					.map((u) =>
						sendTemplatedEmail(u.email, templateMap[u.pendingDecision!], {
							name: u.name,
							hackathon_start: settings.hackathonStartDate.toLocaleDateString(),
							rsvp_deadline: settings.RSVPDeadline.toLocaleDateString()
						})
					)
			);
		}

		await createLog(ctx.prisma, `Released decisions for ${users.length} users`, ctx.user.uid);

		return { released: users.length };
	})
});
