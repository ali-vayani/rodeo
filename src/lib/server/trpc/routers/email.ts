import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { sendEmail } from '$lib/server/email';
import { buildRecipientWhere, recipientFilterSchema } from '$lib/server/recipients';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import { buildTemplateVars, substituteVariables, SAMPLE_VARS } from '$lib/email/variables';

export const emailRouter = router({
	/**
	 * How many users a filter selects, without sending anything.
	 *
	 * Shares `buildRecipientWhere` with `sendCustom` so the count an admin confirms
	 * is by construction the set that gets mailed.
	 */
	previewRecipients: adminProcedure
		.input(recipientFilterSchema.extend({ sampleSize: z.number().int().min(1).max(20).default(5) }))
		.query(async ({ ctx, input }) => {
			const { sampleSize, ...filters } = input;
			const where = buildRecipientWhere(filters);

			const [count, sample] = await Promise.all([
				ctx.prisma.user.count({ where }),
				ctx.prisma.user.findMany({
					where,
					take: sampleSize,
					orderBy: { createdAt: 'desc' },
					select: { uid: true, name: true, email: true }
				})
			]);

			// When targeting an explicit list, tell the admin which addresses don't
			// correspond to a user rather than silently dropping them.
			let unknownEmails: string[] = [];
			if (filters.emails?.length) {
				const matched = await ctx.prisma.user.findMany({
					where: { email: { in: filters.emails } },
					select: { email: true }
				});
				const found = new Set(matched.map((u) => u.email.toLowerCase()));
				unknownEmails = filters.emails.filter((e) => !found.has(e.toLowerCase()));
			}

			return { count, sample, unknownEmails };
		}),

	sendCustom: adminProcedure
		.input(
			z.object({
				subject: z.string().min(1),
				body: z.string().min(1),
				filters: recipientFilterSchema
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters } = input;

			const users = await ctx.prisma.user.findMany({
				where: buildRecipientWhere(filters)
			});

			if (users.length === 0) {
				return { sent: 0 };
			}

			// Personalise per recipient, so {{name}} in a custom blast behaves the same
			// way it does in the lifecycle templates.
			const settings = await ctx.prisma.settings.findFirst();
			await Promise.allSettled(
				users.map((u) => {
					const vars = settings ? buildTemplateVars(u, settings) : {};
					return sendEmail({
						to: u.email,
						subject: substituteVariables(subject, vars),
						body: substituteVariables(body, vars)
					});
				})
			);

			// Store the raw template, not a rendered copy — one row covers N recipients.
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
