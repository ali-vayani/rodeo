import { z } from 'zod';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { sendEmail } from '$lib/server/email';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import { buildTemplateVars, substituteVariables, SAMPLE_VARS } from '$lib/email/variables';

export const emailRouter = router({
	sendCustom: adminProcedure
		.input(
			z.object({
				subject: z.string().min(1),
				body: z.string().min(1),
				filters: z.object({
					roles: z.array(z.nativeEnum(Role)).optional(),
					statuses: z.array(z.nativeEnum(UserStatus)).optional(),
					decisions: z.array(z.nativeEnum(DecisionStatus)).optional()
				})
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters } = input;

			const users = await ctx.prisma.user.findMany({
				where: {
					...(filters.roles?.length && { roles: { hasSome: filters.roles } }),
					...(filters.statuses?.length && { status: { in: filters.statuses } }),
					...(filters.decisions?.length && { activeDecision: { in: filters.decisions } })
				}
			});

			if (users.length === 0) {
				return { sent: 0 };
			}

			await Promise.allSettled(
				users.map((u) => sendEmail({ to: u.email, subject, body }))
			);

			await ctx.prisma.emailLog.create({
				data: {
					subject,
					body,
					userIds: users.map((u) => u.uid),
					sentAt: new Date()
				}
			});

			return { sent: users.length };
		}),

	/**
	 * Sends one lifecycle template to the admin so they can read it in a real inbox.
	 *
	 * Subject and body come from the input rather than the database — proofreading
	 * an unsaved draft is the whole point. Deliberately writes no EmailLog row:
	 * that table is the audit trail of real sends.
	 */
	sendTest: adminProcedure
		.input(
			z.object({
				template: z.enum(TEMPLATE_KEYS),
				subject: z.string().min(1).max(200),
				body: z.string().min(1).max(20000),
				to: z.string().email().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const to = input.to ?? ctx.user.email;
			const settings = await ctx.prisma.settings.findFirst();
			// No Settings row yet on a fresh install — fall back to the preview samples
			// so a test send still demonstrates substitution.
			const vars = settings ? buildTemplateVars(ctx.user, settings) : SAMPLE_VARS;

			await sendEmail({
				to,
				subject: substituteVariables(input.subject, vars),
				body: substituteVariables(input.body, vars)
			});

			return { to };
		}),

	getLogs: adminProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(100).default(20)
			})
		)
		.query(async ({ ctx, input }) => {
			const [total, logs] = await Promise.all([
				ctx.prisma.emailLog.count(),
				ctx.prisma.emailLog.findMany({
					skip: (input.page - 1) * input.pageSize,
					take: input.pageSize,
					orderBy: { sentAt: 'desc' }
				})
			]);

			return { logs, total, page: input.page, pageSize: input.pageSize };
		})
});
