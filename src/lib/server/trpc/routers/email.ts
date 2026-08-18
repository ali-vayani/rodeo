import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { sendEmail } from '$lib/server/email';
import { emailSettings } from '$lib/server/settings';
import {
	resolveRecipientWhere,
	recipientFilterSchema,
	splitExplicitEmails,
	EXTERNAL_RECIPIENT_PREFIX
} from '$lib/server/recipients';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import {
	buildEventVars,
	buildExternalTemplateVars,
	substituteVariables,
	SAMPLE_VARS
} from '$lib/email/variables';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { UserStatus } from '$lib/generated/prisma/enums';
import { logAction } from '$lib/server/log';

/**
 * Whether addresses with no account are recipients or mistakes.
 *
 * Off — the historical behaviour — an explicit address list is a *lookup* into the
 * User table and anything that misses is reported back as unknown and not mailed. On,
 * the misses become real envelope addresses. That is a deliberate widening of the
 * blast radius, so it is an explicit per-request flag rather than something inferred:
 * an admin has to have ticked it.
 */
const allowExternalSchema = z.boolean().default(false);

export const emailRouter = router({
	/**
	 * How many people a filter selects, without sending anything.
	 *
	 * Shares `buildRecipientWhere` and `splitExplicitEmails` with `sendCustom` so the
	 * count an admin confirms is by construction the set that gets mailed.
	 */
	previewRecipients: adminProcedure
		.input(
			recipientFilterSchema.extend({
				sampleSize: z.number().int().min(1).max(20).default(5),
				allowExternal: allowExternalSchema
			})
		)
		.query(async ({ ctx, input }) => {
			const { sampleSize, allowExternal, ...filters } = input;
			const { where, expansion } = await resolveRecipientWhere(ctx.prisma, filters);

			const [userCount, sample] = await Promise.all([
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
			let matched: { email: string }[] = [];
			let unknownEmails: string[] = [];
			if (filters.emails?.length) {
				matched = await ctx.prisma.user.findMany({
					where: { email: { in: filters.emails.map((e) => e.trim().toLowerCase()) } },
					select: { email: true }
				});
				const found = new Set(matched.map((u) => u.email.toLowerCase()));
				unknownEmails = filters.emails.filter((e) => !found.has(e.trim().toLowerCase()));
			}

			// With the toggle on those same misses stop being errors and start being
			// recipients, so they are counted here — the count is what the send is bound
			// to, and an uncounted recipient would trip the drift check on every send.
			const { external, invalid } = allowExternal
				? splitExplicitEmails(filters.emails, matched)
				: { external: [] as string[], invalid: [] as string[] };

			return {
				count: userCount + external.length,
				userCount,
				sample,
				unknownEmails,
				externalEmails: external,
				invalidEmails: invalid,
				// Which names a typo'd search fell back to, so the confirm step can say
				// "no exact match — these 3 look close" before anything is sent.
				search: expansion
			};
		}),

	/**
	 * The recipient-independent variables, already rendered to the exact strings a
	 * send will substitute.
	 *
	 * The compose preview needs these; it must not format the dates itself, because
	 * `toLocaleDateString()` in the browser uses the viewer's locale and timezone
	 * rather than the server's. Never null: `sendCustom` falls back to
	 * `DEFAULT_SETTINGS` when no row exists, so the preview shows the same.
	 */
	eventVars: adminProcedure.query(async ({ ctx }) => {
		return buildEventVars(emailSettings(await ctx.prisma.settings.findFirst()));
	}),

	/**
	 * Sends a hand-written email to the selected recipients.
	 *
	 * With `allowExternal` this reaches addresses that have no portal account, which is
	 * the same capability `sendTest` had its `to` field removed for — see the comment
	 * there. What makes it acceptable here and not there is that all three of that
	 * incident's mitigations survive: it is `adminProcedure`, the send **is** written to
	 * EmailLog with every address it reached, and the audit entry names the external
	 * count. The relay was dangerous because it was untraceable, not because it had a
	 * recipient field.
	 */
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
				expectedCount: z.number().int().min(0),
				allowExternal: allowExternalSchema
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters, expectedCount, allowExternal } = input;

			// Same resolver as previewRecipients, including the fuzzy-search expansion:
			// both sides derive the recipient set from the input the same way, so the
			// drift check below only ever fires on a set that genuinely changed.
			const { where } = await resolveRecipientWhere(ctx.prisma, filters);
			const users = await ctx.prisma.user.findMany({ where });

			// Resolved by membership in the User table, not against `users` — the same
			// question `previewRecipients` asks. Deriving it from the filtered set instead
			// would call a real hacker "external" whenever another filter excluded them.
			let external: string[] = [];
			if (allowExternal && filters.emails?.length) {
				const matched = await ctx.prisma.user.findMany({
					where: { email: { in: filters.emails.map((e) => e.trim().toLowerCase()) } },
					select: { email: true }
				});
				external = splitExplicitEmails(filters.emails, matched).external;
			}

			// External addresses count toward the binding exactly like users do: the
			// number the admin confirmed is the number of messages that go out.
			const total = users.length + external.length;
			if (total !== expectedCount) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `The recipient list changed since you previewed it (${expectedCount} then, ${total} now). Review and try again.`
				});
			}

			if (total === 0) {
				return { sent: 0, external: 0 };
			}

			// Personalise per recipient, so {{name}} in a custom blast behaves the same
			// way it does in the lifecycle templates. External recipients have no User row
			// to read a name off and get the documented fallback instead.
			// The raw row goes to buildEmailPersonalization, which defaults the email
			// half itself — the check-in block's wallet gate must fail closed when no
			// Settings row exists.
			const settingsRow = await ctx.prisma.settings.findFirst();
			const externalVars = buildExternalTemplateVars(emailSettings(settingsRow));
			const results = await Promise.allSettled([
				...users.map(async (u) => {
					// Per recipient: the check-in block embeds that hacker's own QR as an
					// inline attachment, and is empty for anyone who hasn't confirmed.
					const { vars, attachments } = await buildEmailPersonalization(u, settingsRow);
					return sendEmail({
						to: u.email,
						subject: substituteVariables(subject, vars, { dropRawValues: true }),
						body: substituteVariables(body, vars, { escapeValues: true }),
						attachments
					});
				}),
				...external.map((email) =>
					sendEmail({
						to: email,
						subject: substituteVariables(subject, externalVars, { dropRawValues: true }),
						body: substituteVariables(body, externalVars, { escapeValues: true })
					})
				)
			]);
			const failed = results.filter((r) => r.status === 'rejected').length;

			// Store the raw template, not a rendered copy — one row covers N recipients.
			// External addresses are recorded prefixed rather than omitted, so the row
			// still accounts for every message this send produced.
			const emailLog = await ctx.prisma.emailLog.create({
				data: {
					subject,
					body,
					userIds: [
						...users.map((u) => u.uid),
						...external.map((email) => `${EXTERNAL_RECIPIENT_PREFIX}${email}`)
					],
					sentAt: new Date()
				}
			});

			// EmailLog already holds the body and the recipient list; the audit entry
			// records the act — who pressed send, on how many people — and points at
			// that row rather than duplicating it. Reaching outside the portal is the
			// part a reader needs to see without opening the row, so it goes in the
			// sentence as well as the metadata.
			const reached =
				external.length > 0
					? `${total} ${total === 1 ? 'recipient' : 'recipients'} ` +
						`(${users.length} with accounts, ${external.length} external)`
					: `${users.length} ${users.length === 1 ? 'user' : 'users'}`;

			await logAction(ctx, {
				action: 'email.custom.send',
				summary:
					`Sent a custom email "${subject}" to ${reached}` +
					(failed > 0 ? ` — ${failed} failed to send` : ''),
				target: { id: emailLog.id, label: subject },
				metadata: {
					recipients: total,
					users: users.length,
					external: external.length,
					externalAllowed: allowExternal,
					failed,
					subject
				}
			});

			return { sent: total, external: external.length };
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

			// No Settings row yet on a fresh install — fall back to the preview samples for
			// the dates so a test send still demonstrates substitution. `name` is overridden
			// with the real recipient regardless: this mail lands in the admin's own inbox,
			// and greeting them by a stand-in name is the one substitution a proofreading
			// send must never show.
			//
			// The status override is the one deliberate lie in this procedure. Most
			// admins are not confirmed hackers, so a truthful render would drop
			// `{{check_in_pass}}` to nothing and leave the organizer unable to
			// proofread the block they just inserted — which is the entire purpose of
			// a test send. The QR encodes the admin's own uid and the wallet links
			// still refuse them at the endpoint, so nothing is granted by pretending.
			const { vars, attachments } = settings
				? await buildEmailPersonalization({ ...ctx.user, status: UserStatus.CONFIRMED }, settings)
				: { vars: { ...SAMPLE_VARS, name: ctx.user.name }, attachments: [] };

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
