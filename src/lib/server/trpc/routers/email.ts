import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { sendEmail } from '$lib/server/email';
import { buildRecipientWhere, recipientFilterSchema } from '$lib/server/recipients';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import { substituteVariables, SAMPLE_VARS } from '$lib/email/variables';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { UserStatus } from '$lib/generated/prisma/client';
import { logAction } from '$lib/server/log';

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
					where: { email: { in: filters.emails.map((e) => e.trim().toLowerCase()) } },
					select: { email: true }
				});
				const found = new Set(matched.map((u) => u.email.toLowerCase()));
				unknownEmails = filters.emails.filter((e) => !found.has(e.trim().toLowerCase()));
			}

			return { count, sample, unknownEmails };
		}),

	sendCustom: adminProcedure
		.input(
			z.object({
				subject: z.string().min(1).max(200),
				body: z.string().min(1).max(20000),
				filters: recipientFilterSchema,
				// The recipient count the admin saw in the confirm step. The send is bound to
				// it: recipients.ts documents that `filters: {}` matches everyone, so a client
				// bug or a replay that lost the filters would otherwise blast the whole
				// database. If the set has changed since preview, we refuse rather than send.
				expectedCount: z.number().int().min(0)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters, expectedCount } = input;

			const users = await ctx.prisma.user.findMany({
				where: buildRecipientWhere(filters)
			});

			if (users.length !== expectedCount) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `The recipient list changed since you previewed it (${expectedCount} then, ${users.length} now). Review and try again.`
				});
			}

			if (users.length === 0) {
				return { sent: 0 };
			}

			// Personalise per recipient, so {{name}} in a custom blast behaves the same
			// way it does in the lifecycle templates.
			const settings = await ctx.prisma.settings.findFirst();
			const results = await Promise.allSettled(
				users.map(async (u) => {
					// Per recipient: the check-in block embeds that hacker's own QR as an
					// inline attachment, and is empty for anyone who hasn't confirmed.
					const { vars, attachments } = settings
						? await buildEmailPersonalization(u, settings)
						: { vars: {}, attachments: [] };

					return sendEmail({
						to: u.email,
						subject: substituteVariables(subject, vars, { dropRawValues: true }),
						body: substituteVariables(body, vars, { escapeValues: true }),
						attachments
					});
				})
			);
			const failed = results.filter((r) => r.status === 'rejected').length;

			// Store the raw template, not a rendered copy — one row covers N recipients.
			const emailLog = await ctx.prisma.emailLog.create({
				data: {
					subject,
					body,
					userIds: users.map((u) => u.uid),
					sentAt: new Date()
				}
			});

			// EmailLog already holds the body and the recipient list; the audit entry
			// records the act — who pressed send, on how many people — and points at
			// that row rather than duplicating it.
			await logAction(ctx, {
				action: 'email.custom.send',
				summary:
					`Sent a custom email "${subject}" to ${users.length} ${users.length === 1 ? 'user' : 'users'}` +
					(failed > 0 ? ` — ${failed} failed to send` : ''),
				target: { id: emailLog.id, label: subject },
				metadata: { recipients: users.length, failed, subject }
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
				body: z.string().min(1).max(20000)
			})
		)
		.mutation(async ({ ctx, input }) => {
			// Always to the admin's own address — this exists to read a draft in a real
			// inbox. Accepting an arbitrary `to` turned it into an authenticated relay that
			// could send hand-written HTML from the org's From: address to anyone, with the
			// body deliberately never written to EmailLog. "Yourself" is the whole feature.
			const to = ctx.user.email;
			const settings = await ctx.prisma.settings.findFirst();

			// No Settings row yet on a fresh install — fall back to the preview samples
			// so a test send still demonstrates substitution.
			//
			// The status override is the one deliberate lie in this procedure. Most
			// admins are not confirmed hackers, so a truthful render would drop
			// `{{check_in_pass}}` to nothing and leave the organizer unable to
			// proofread the block they just inserted — which is the entire purpose of
			// a test send. The QR encodes the admin's own uid and the wallet links
			// still refuse them at the endpoint, so nothing is granted by pretending.
			const { vars, attachments } = settings
				? await buildEmailPersonalization({ ...ctx.user, status: UserStatus.CONFIRMED }, settings)
				: { vars: SAMPLE_VARS, attachments: [] };

			await sendEmail({
				to,
				subject: substituteVariables(input.subject, vars, { dropRawValues: true }),
				body: substituteVariables(input.body, vars, { escapeValues: true }),
				attachments
			});

			await logAction(ctx, {
				action: 'email.test.send',
				summary: `Sent a test "${input.template}" email to ${to}`,
				metadata: { template: input.template, to }
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
