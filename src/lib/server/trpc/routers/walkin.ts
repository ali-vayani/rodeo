import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure, portalProcedure } from '../init';
import { isStaff } from '$lib/auth/permissions';
import { normalizeEmail } from '$lib/blacklist/match';
import { isAnswered } from '$lib/questions/isAnswered';
import { isWalkInUnlocked } from '$lib/walkin/unlock';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { templateBlockers } from '$lib/email/variables';
import { emailSettings } from '$lib/server/settings';
import { resolveTemplate } from '$lib/server/emailTemplates';
import { logAction } from '$lib/server/log';
import { toSelfUser } from '../selects';
import { reportSendFailure, sendableTemplate } from './application';

/**
 * Walk-in registration: staff invite an email on event day, the invitee signs in and
 * confirms a spot without going through admissions.
 *
 * The staff endpoints are `portalProcedure` deliberately — walk-ins are event-day desk
 * work, organizers run the desk. That exposes the invited names, emails and statuses to
 * organizers, the same event-ops exception `scan.lookupByEmail` already makes; see the
 * note in $lib/auth/permissions.
 */
export const walkinRouter = router({
	/**
	 * Invite an email as a walk-in. Upserts the account so the invitee's first sign-in
	 * with that address lands on it (`getProdSession` matches by email), then mails the
	 * walk-in template. Re-inviting the same email just refreshes the timestamp and
	 * resends — that is the recovery path when the first message goes missing.
	 */
	invite: portalProcedure
		.input(
			z.object({
				email: z.string().trim().toLowerCase().email('Enter a valid email address.')
			})
		)
		.mutation(async ({ ctx, input }) => {
			const settings = await ctx.prisma.settings.findFirst();

			// The same rule the admin page greys itself out with.
			if (!isWalkInUnlocked(settings)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Walk-ins open on the day of the event.'
				});
			}

			// Refused up front, unlike `application.submit`'s silent auto-reject: inviting a
			// blacklisted email and watching them be rejected at the door helps nobody.
			const email = normalizeEmail(input.email);
			const blacklisted = await ctx.prisma.blacklist.findUnique({
				where: { email },
				select: { id: true }
			});
			if (blacklisted) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'That email is on the blacklist.' });
			}

			const existing = await ctx.prisma.user.findUnique({
				where: { email },
				select: { role: true, status: true }
			});
			if (existing && isStaff(existing.role)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'That email belongs to a staff account, which cannot attend as a hacker.'
				});
			}
			if (existing?.status === UserStatus.CHECKED_IN) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is already checked in.' });
			}

			// `name: ''` renders as the NAME_FALLBACK salutation until a linked question
			// fills it — the same state a self-registered account starts in.
			const user = await ctx.prisma.user.upsert({
				where: { email },
				update: { walkInInvitedAt: new Date() },
				create: { email, name: '', role: Role.HACKER, walkInInvitedAt: new Date() }
			});

			// Staff-initiated, so a template that cannot send is refused loudly up front,
			// like `email.startSend` — the sender is standing at a desk and needs to know.
			// Resolved per role like every other lifecycle send; walk-ins are HACKERs
			// unless the account already held another applicant role.
			const mail = emailSettings(settings);
			const overrides = await ctx.prisma.templateOverride.findMany({
				where: { templateKey: 'walkin' }
			});
			const inviteTemplate = resolveTemplate(mail, overrides, 'walkin', user.role);
			if (!inviteTemplate.body) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'The walk-in email template is empty. An admin can set it under Email Templates.'
				});
			}
			const blocked = templateBlockers(
				[inviteTemplate.subject, inviteTemplate.body],
				settings ?? { RSVPDeadline: null }
			);
			if (blocked) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: blocked.message });
			}

			const { vars, attachments } = await buildEmailPersonalization(user, settings);
			await sendTemplatedEmail(user.email, inviteTemplate, vars, attachments);

			await logAction(ctx, {
				action: 'walkin.invite',
				summary: `Invited ${user.email} as a walk-in`,
				target: { id: user.uid, label: user.email }
			});

			return { uid: user.uid, email: user.email, status: user.status };
		}),

	/**
	 * Revoke an invite: clears the stamp, which closes the Walk-In tab, the confirm
	 * path, and the deadline bypasses for that account. Deliberately does NOT touch
	 * status — someone who already confirmed stays CONFIRMED, and demoting them is the
	 * Users page's job. CHECKED_IN is refused outright: they are physically here, and
	 * removing them from the desk's table would only hide a present attendee.
	 */
	uninvite: portalProcedure
		.input(z.object({ uid: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUnique({
				where: { uid: input.uid },
				select: { uid: true, email: true, status: true, walkInInvitedAt: true }
			});
			if (!user?.walkInInvitedAt) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'That person has no walk-in invite.' });
			}
			if (user.status === UserStatus.CHECKED_IN) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is already checked in.' });
			}

			await ctx.prisma.user.update({
				where: { uid: user.uid },
				data: { walkInInvitedAt: null }
			});

			await logAction(ctx, {
				action: 'walkin.uninvite',
				summary: `Revoked the walk-in invite for ${user.email}`,
				target: { id: user.uid, label: user.email }
			});

			return { uid: user.uid };
		}),

	/** Everyone invited, newest first, for the desk's live table. */
	list: portalProcedure.query(async ({ ctx }) => {
		return ctx.prisma.user.findMany({
			where: { walkInInvitedAt: { not: null } },
			orderBy: { walkInInvitedAt: 'desc' },
			select: {
				uid: true,
				name: true,
				email: true,
				status: true,
				isWalkIn: true,
				walkInInvitedAt: true
			}
		});
	}),

	/**
	 * The invitee claims their spot. An existing application (any status short of
	 * CONFIRMED) is taken as-is; an account that never applied must have answered every
	 * required walk-in question first. Either way the account lands CONFIRMED with an
	 * ACCEPTED decision — deliberately overriding a released REJECTED or WAITLISTED
	 * decision and even a DECLINED RSVP, because the invite is staff saying "come in
	 * anyway", and check-in only promotes from CONFIRMED.
	 */
	confirm: authedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.prisma.user.findUniqueOrThrow({ where: { uid: ctx.user.uid } });

		if (!user.walkInInvitedAt) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'You have not been invited as a walk-in.'
			});
		}
		if (user.status === UserStatus.CHECKED_IN) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already checked in.' });
		}
		if (user.status === UserStatus.CONFIRMED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Your spot is already confirmed — show the QR code on your Account page.'
			});
		}

		// Re-checked here, not just at invite time: a block added after the invite went
		// out must still hold. The message stays generic — the blacklist is not announced
		// to the person on it, same as submit's silent auto-reject.
		const blacklisted = await ctx.prisma.blacklist.findUnique({
			where: { email: normalizeEmail(user.email) },
			select: { id: true }
		});
		if (blacklisted) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Your spot could not be confirmed. Please see the organizers at the check-in desk.'
			});
		}

		const settings = await ctx.prisma.settings.findFirst();

		// No submitted application: the walk-in questions stand in for it. Same required
		// check as `application.submit`, over the walk-in subset.
		if (user.status === UserStatus.CREATED) {
			const [questions, responses] = await Promise.all([
				ctx.prisma.question.findMany({
					where: {
						walkIn: true,
						required: true,
						OR: [{ targetRole: { isEmpty: true } }, { targetRole: { has: user.role } }]
					}
				}),
				ctx.prisma.applicationResponse.findMany({ where: { userId: user.uid } })
			]);

			const answers = new Map(responses.map((r) => [r.questionId, r.value]));
			const unanswered = questions.filter((q) => !isAnswered(q.type, answers.get(q.id)));
			if (unanswered.length > 0) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Please answer all required questions. Missing: ${unanswered.map((q) => q.title).join(', ')}`
				});
			}
		}

		// Compare-and-swap, same as `submit`: two rapid confirms must send one email.
		// Both decision columns move together so the record never says "pending REJECTED,
		// active ACCEPTED" about the same person.
		const confirmed = await ctx.prisma.user.updateMany({
			where: {
				uid: user.uid,
				status: { notIn: [UserStatus.CONFIRMED, UserStatus.CHECKED_IN] }
			},
			data: {
				status: UserStatus.CONFIRMED,
				isWalkIn: true,
				pendingDecision: DecisionStatus.ACCEPTED,
				activeDecision: DecisionStatus.ACCEPTED
			}
		});
		if (confirmed.count === 0) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Your spot is already confirmed.' });
		}

		const updated = await ctx.prisma.user.findUniqueOrThrow({ where: { uid: user.uid } });

		await logAction(ctx, {
			action: 'walkin.confirm',
			summary: `Confirmed their walk-in spot`,
			target: { id: updated.uid, label: updated.email }
		});

		// The same confirmation mail an RSVP sends, QR block and all — this is the email
		// they show at the check-in desk if their phone dies on the portal. Resolved per
		// role, matching `application.rsvp`.
		const mail = emailSettings(settings);
		const overrides = await ctx.prisma.templateOverride.findMany({
			where: { templateKey: 'confirm' }
		});
		const confirmTemplate = resolveTemplate(mail, overrides, 'confirm', updated.role);
		if (sendableTemplate('walk-in confirmation', confirmTemplate, settings, updated.email)) {
			const { vars, attachments } = await buildEmailPersonalization(updated, settings);
			await sendTemplatedEmail(updated.email, confirmTemplate, vars, attachments).catch(
				reportSendFailure('walk-in confirmation', updated.email)
			);
		}

		return toSelfUser(updated);
	})
});
