import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { sendEmail, type EmailAttachment } from '$lib/server/email';
import { emailSettings } from '$lib/server/settings';
import {
	resolveRecipientWhere,
	recipientFilterSchema,
	splitExplicitEmails,
	EXTERNAL_RECIPIENT_PREFIX
} from '$lib/server/recipients';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import { malformedEmails } from '$lib/email/address';
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
 * Off, an explicit address list is a lookup into the User table and anything that
 * misses is reported back as unknown and not mailed. On, the misses become real
 * envelope addresses. That widens the blast radius, so it is an explicit per-request
 * flag rather than something inferred.
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
					// `status` so the compose preview can show the QR block only to sampled recipients
					// who would actually receive one.
					select: { uid: true, name: true, email: true, status: true }
				})
			]);

			// When targeting an explicit list, tell the admin which addresses don't
			// correspond to a user rather than silently dropping them.
			let unknownEmails: string[] = [];
			let externalEmails: string[] = [];
			let invalidEmails: string[] = [];
			if (filters.emails?.length) {
				const matched = await ctx.prisma.user.findMany({
					where: { email: { in: filters.emails.map((e) => e.trim().toLowerCase()) } },
					select: { email: true }
				});

				// `allowExternal` governs whether an unmatched address is mailed, not whether
				// the list is checked: a typo must surface while it can still be fixed.
				const split = splitExplicitEmails(filters.emails, matched);
				invalidEmails = split.invalid;
				// With the toggle on, misses become recipients and must be counted: an
				// uncounted recipient would trip the drift check in `sendCustom`.
				if (allowExternal) externalEmails = split.external;

				const found = new Set(matched.map((u) => u.email.toLowerCase()));
				const bad = new Set(invalidEmails);
				// One classification per address: an unreadable entry is not also reported as
				// "matched no user", which would list it twice.
				unknownEmails = filters.emails.filter((e) => {
					const email = e.trim().toLowerCase();
					return !found.has(email) && !bad.has(email);
				});
			}

			return {
				count: userCount + externalEmails.length,
				userCount,
				sample,
				unknownEmails,
				externalEmails,
				invalidEmails,
				// Which names a typo'd search fell back to, so the confirm step can say
				// "no exact match — these 3 look close" before anything is sent.
				search: expansion
			};
		}),

	/**
	 * The recipient-independent variables, already rendered to the exact strings a send
	 * will substitute.
	 *
	 * The compose preview must not format the dates itself, because `toLocaleDateString()`
	 * in the browser uses the viewer's locale and timezone. Never null: `sendCustom` falls
	 * back to `DEFAULT_SETTINGS` when no row exists, so the preview shows the same.
	 */
	eventVars: adminProcedure.query(async ({ ctx }) => {
		return buildEventVars(emailSettings(await ctx.prisma.settings.findFirst()));
	}),

	/**
	 * Resolves the recipient set, records the send, and hands the list to the client.
	 *
	 * Delivery is driven from the browser, one `sendOne` per recipient, because Resend
	 * caps a team at 10 requests/second. Mailing N people therefore takes at least N/10
	 * seconds, and a server-side loop over a few hundred outlives the request. Pacing in
	 * the page keeps every function invocation to a single message and gives the admin a
	 * live count instead of a spinner.
	 *
	 * The EmailLog row is written here, before anything is sent, rather than after the
	 * last message. A send that stops early — closed tab, dead laptop — must still leave
	 * a record naming who was reached, or the only safe recovery is to mail everyone a
	 * second time.
	 *
	 * With `allowExternal` this reaches addresses that have no portal account, the same
	 * capability `sendTest` had its `to` field removed for. What makes it acceptable here
	 * is that the send is written to EmailLog with every address it reached and the audit
	 * entry names the external count. That relay was dangerous because it was untraceable.
	 *
	 * Throws:
	 * - TRPCError BAD_REQUEST — an explicit address is malformed; the whole send is refused
	 * - TRPCError CONFLICT — the recipient set no longer matches `expectedCount`
	 */
	startSend: adminProcedure
		.input(
			z.object({
				subject: z.string().min(1).max(200),
				body: z.string().min(1).max(20000),
				filters: recipientFilterSchema,
				// The recipient count the admin saw in the confirm step. The send is bound to it:
				// `filters: {}` matches everyone, so a client bug or a replay that lost the filters
				// would otherwise blast the whole database.
				expectedCount: z.number().int().min(0),
				allowExternal: allowExternalSchema
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters, expectedCount, allowExternal } = input;

			// Before any query, and whatever the toggle says. The page strips malformed entries,
			// so reaching this means a caller bypassed it — refuse rather than mail the rest.
			const malformed = malformedEmails(filters.emails ?? []);
			if (malformed.length) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Not valid email addresses: ${malformed.join(', ')}`
				});
			}

			// Same resolver as previewRecipients, including the fuzzy-search expansion, so the
			// drift check below only ever fires on a set that genuinely changed.
			const { where } = await resolveRecipientWhere(ctx.prisma, filters);
			const users = await ctx.prisma.user.findMany({ where, select: { uid: true } });

			// Resolved by membership in the User table, not against `users`. Deriving it from
			// the filtered set would call a real hacker "external" whenever a filter excluded them.
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
				return { sendId: null, recipients: [], users: 0, external: 0 };
			}

			// One identifier per recipient, in the spelling EmailLog already stores: a uid for
			// an account holder, a prefixed address for everyone else. `sendOne` refuses
			// anything absent from this list, which is what stops it being an open relay.
			const recipients = [
				...users.map((u) => u.uid),
				...external.map((email) => `${EXTERNAL_RECIPIENT_PREFIX}${email}`)
			];

			// Stores the raw template, not a rendered copy: one row covers N recipients, and
			// `sendOne` reads the body back from here so it cannot be rewritten mid-send.
			const emailLog = await ctx.prisma.emailLog.create({
				data: { subject, body, userIds: recipients }
			});

			const reached =
				external.length > 0
					? `${total} ${total === 1 ? 'recipient' : 'recipients'} ` +
						`(${users.length} with accounts, ${external.length} external)`
					: `${users.length} ${users.length === 1 ? 'user' : 'users'}`;

			// Logged at the start, not the end. `finishSend` records the outcome, but a blast
			// abandoned half-way never gets there — and that is exactly the case where an
			// audit trail matters, so the attempt goes in the log the moment it is committed.
			await logAction(ctx, {
				action: 'email.custom.start',
				summary: `Started a custom email "${subject}" to ${reached}`,
				target: { id: emailLog.id, label: subject },
				metadata: {
					recipients: total,
					users: users.length,
					external: external.length,
					externalAllowed: allowExternal,
					subject
				}
			});

			return {
				sendId: emailLog.id,
				recipients,
				users: users.length,
				external: external.length
			};
		}),

	/**
	 * Delivers one message from a started send.
	 *
	 * Never throws on a delivery failure. The page walks the recipient list one call at a
	 * time, so a rejection that propagated would end the whole blast on the first bad
	 * address — the failure is recorded, returned, and the loop carries on.
	 *
	 * `retryable` marks the failures worth another attempt: a 429 means the send was
	 * paced too fast, not that the address is bad.
	 *
	 * Throws:
	 * - TRPCError NOT_FOUND — no such send, or its recipient has since been deleted
	 * - TRPCError FORBIDDEN — the recipient is not part of this send
	 */
	sendOne: adminProcedure
		.input(z.object({ sendId: z.string(), recipient: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const log = await ctx.prisma.emailLog.findUnique({ where: { id: input.sendId } });
			if (!log) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'That send no longer exists.' });
			}

			// Subject, body and the recipient set all come from the stored row. Nothing the
			// caller passes can retarget a send or change what it says after it was recorded.
			if (!log.userIds.includes(input.recipient)) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'That recipient is not part of this send.'
				});
			}

			// Idempotent by recipient, so a resumed or retried loop cannot put a second copy
			// in an inbox that already has one.
			if (log.sent.includes(input.recipient)) {
				return { ok: true, skipped: true, error: null, retryable: false };
			}

			const settings = await ctx.prisma.settings.findFirst();

			let to: string;
			let vars: Record<string, string>;
			let attachments: EmailAttachment[] = [];

			if (input.recipient.startsWith(EXTERNAL_RECIPIENT_PREFIX)) {
				to = input.recipient.slice(EXTERNAL_RECIPIENT_PREFIX.length);
				vars = buildExternalTemplateVars(emailSettings(settings));
			} else {
				const user = await ctx.prisma.user.findUnique({ where: { uid: input.recipient } });
				if (!user) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'That recipient no longer has an account.'
					});
				}
				to = user.email;
				// Raw row, not `emailSettings(...)`: the check-in block embeds this hacker's own
				// QR as an inline attachment and its wallet gate must fail closed on an
				// unconfigured install. See buildEmailPersonalization.
				({ vars, attachments } = await buildEmailPersonalization(user, settings));
			}

			try {
				await sendEmail({
					to,
					// `dropRawValues` in the subject because it is plain text; `escapeValues` in
					// the body because it is rendered to HTML. Same split as sendTemplatedEmail.
					subject: substituteVariables(log.subject, vars, { dropRawValues: true }),
					body: substituteVariables(log.body, vars, { escapeValues: true }),
					attachments
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await ctx.prisma.emailLog.update({
					where: { id: log.id },
					data: log.failed.includes(input.recipient) ? {} : { failed: { push: input.recipient } }
				});
				return {
					ok: false,
					skipped: false,
					error: message,
					// Resend names its rate-limit rejection `rate_limit_exceeded`, which
					// `sendEmail` carries through into the message.
					retryable: /rate_limit|rate limit|429/i.test(message)
				};
			}

			await ctx.prisma.emailLog.update({
				where: { id: log.id },
				data: {
					sent: { push: input.recipient },
					// Clears an earlier attempt, so a recipient who failed and then succeeded is
					// not counted in both columns.
					...(log.failed.includes(input.recipient)
						? { failed: { set: log.failed.filter((r) => r !== input.recipient) } }
						: {})
				}
			});

			return { ok: true, skipped: false, error: null, retryable: false };
		}),

	/**
	 * Closes out a send with the tallies the row accumulated.
	 *
	 * Counts are read back from EmailLog rather than taken from the client, so the audit
	 * entry reports what the server actually did. A blast abandoned mid-way never reaches
	 * here; the `email.custom.start` entry and the row's own columns cover that case.
	 *
	 * Throws:
	 * - TRPCError NOT_FOUND — no such send
	 */
	finishSend: adminProcedure
		.input(z.object({ sendId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const log = await ctx.prisma.emailLog.findUnique({ where: { id: input.sendId } });
			if (!log) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'That send no longer exists.' });
			}

			const sent = log.sent.length;
			const failed = log.failed.length;
			const total = log.userIds.length;

			await logAction(ctx, {
				action: 'email.custom.send',
				summary:
					`Sent a custom email "${log.subject}" to ${sent} of ${total} ` +
					`${total === 1 ? 'recipient' : 'recipients'}` +
					(failed > 0 ? ` — ${failed} failed to send` : ''),
				target: { id: log.id, label: log.subject },
				metadata: { recipients: total, sent, failed, subject: log.subject }
			});

			return { sent, failed, total };
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
			// Always to the admin's own address. Accepting an arbitrary `to` turned this into an
			// authenticated relay that could send hand-written HTML from the org's From: address
			// to anyone, with the body deliberately never written to EmailLog.
			const to = ctx.user.email;
			const settings = await ctx.prisma.settings.findFirst();

			// No Settings row yet on a fresh install, so fall back to the preview samples for the
			// dates. `name` is overridden with the real recipient regardless: this lands in the
			// admin's own inbox, and greeting them by a stand-in is the one substitution a
			// proofreading send must never show.
			//
			// The status override is the one deliberate lie here. Most admins are not confirmed
			// hackers, so a truthful render would drop `{{hacker_qr_code}}` and leave the organizer
			// unable to proofread the block they just inserted. The QR encodes the admin's own uid
			// and the wallet links still refuse them, so nothing is granted by pretending.
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
