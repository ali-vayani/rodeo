import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { normalizeEmail } from '$lib/blacklist/match';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildTemplateVars } from '$lib/email/variables';
import { formatDateLong } from '$lib/format';

/**
 * The three columns that gate everything in this router.
 *
 * Structurally typed so a Prisma `Settings` row passes without this file caring about
 * the other sixteen columns, and so the guards below can be exercised on a literal.
 */
type ApplicationWindow = {
	applicationOpen: Date;
	applicationDeadline: Date;
	RSVPDeadline: Date;
};

/**
 * Why a missing Settings row opens the gate instead of closing it.
 *
 * `seed.ts` creates no Settings row, and `DEFAULT_SETTINGS` in the settings router is
 * three `new Date()` values evaluated at import — so a fresh install has no window, and
 * anything it could be made to stand in for is already expired by the time the process
 * has been up a second. Reading "unconfigured" as "closed" would therefore lock every
 * applicant out of an event nobody has set up yet, and the first person to find out
 * would be an applicant, not an admin. An absent row means no window is enforced; one
 * save of /admin/settings turns enforcement on.
 *
 * These guards are applicant-facing only. Admins reach status through
 * `admissions.setDecision`, which is deliberately unaffected — closing applications must
 * not also stop the organizers from working through the ones already in.
 */
function assertWithinApplicationWindow(settings: ApplicationWindow | null) {
	if (!settings) return;

	const now = new Date();
	if (now < settings.applicationOpen) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Applications don't open until ${formatDateLong(settings.applicationOpen)}.`
		});
	}
	if (now > settings.applicationDeadline) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Applications closed on ${formatDateLong(settings.applicationDeadline)}. Contact the organizers if you believe this is a mistake.`
		});
	}
}

/**
 * Guards `rsvp` — and deliberately not `rsvpDecline`. Same missing-row rule as above.
 *
 * The RSVP deadline exists so organizers can freeze the confirmed headcount they buy
 * food, badges, and floor space against. A late *confirmation* grows that number after
 * it was frozen, which is exactly what has to be stopped. A late *decline* only shrinks
 * it: refusing one leaves a spot held by someone who has just told us they aren't
 * coming, which is strictly worse for the event than taking the information. So a
 * decline is accepted at any time.
 *
 * The asymmetry is one-way on purpose — a hacker who declines late cannot re-confirm,
 * because re-confirming is the post-deadline growth this guard rejects.
 */
function assertBeforeRSVPDeadline(settings: ApplicationWindow | null) {
	if (!settings) return;

	if (new Date() > settings.RSVPDeadline) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `The RSVP deadline passed on ${formatDateLong(settings.RSVPDeadline)}. Contact the organizers if you still plan to attend.`
		});
	}
}

export const applicationRouter = router({
	/**
	 * Get all responses for the current user
	 */
	getMyResponses: authedProcedure.query(async ({ ctx }) => {
		return ctx.prisma.applicationResponse.findMany({
			where: { userId: ctx.user.uid },
			include: { question: true }
		});
	}),

	/**
	 * Save a response for a question
	 *
	 * Writable only while the application is still CREATED, and only inside the
	 * application window. Once it is submitted, the answers are the thing an admin
	 * reviews and decides on — leaving this open lets the text behind an accepted (or
	 * rejected) application change out from under the decision, and an upsert here
	 * writes no audit entry, so nothing downstream would ever show that it moved.
	 *
	 * @param questionId - the id of the question
	 * @param value - the value of the response
	 */
	save: authedProcedure
		.input(
			z.object({
				questionId: z.string(),
				value: z.string()
			})
		)
		.mutation(async ({ ctx, input }) => {
			// This runs on every field blur, so the two gate reads go out together rather
			// than in series. `ctx.user` is not trusted for status: it was loaded when the
			// request arrived, and a decision may have landed since.
			const [user, settings] = await Promise.all([
				ctx.prisma.user.findUniqueOrThrow({
					where: { uid: ctx.user.uid },
					select: { status: true }
				}),
				ctx.prisma.settings.findFirst()
			]);

			if (user.status !== UserStatus.CREATED) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Your application has already been submitted and can no longer be edited.'
				});
			}

			assertWithinApplicationWindow(settings);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const question = (await (ctx.prisma.question.findUnique as any)({
				where: { id: input.questionId },
				select: { linkedField: true }
			})) as { linkedField?: string | null } | null;

			// Write through to the user record for linked fields
			const LINKED_USER_FIELDS = ['name', 'university', 'year'] as const;
			if (
				question?.linkedField &&
				(LINKED_USER_FIELDS as readonly string[]).includes(question.linkedField)
			) {
				await ctx.prisma.user.update({
					where: { uid: ctx.user.uid },
					data: { [question.linkedField]: input.value }
				});
			}

			return ctx.prisma.applicationResponse.upsert({
				where: {
					userId_questionId: {
						userId: ctx.user.uid,
						questionId: input.questionId
					}
				},
				update: { value: input.value },
				create: {
					userId: ctx.user.uid,
					questionId: input.questionId,
					value: input.value
				}
			});
		}),

	/**
	 * RSVP — confirm attendance after being accepted
	 */
	rsvp: authedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid }
		});
		const settings = await ctx.prisma.settings.findFirst();

		if (user.activeDecision !== DecisionStatus.ACCEPTED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'You must be accepted before you can RSVP.'
			});
		}

		if (user.status === UserStatus.CONFIRMED) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: "You have already RSVP'd." });
		}

		// After the caller's own state, so someone who already RSVP'd is told that rather
		// than being handed a deadline that no longer concerns them.
		assertBeforeRSVPDeadline(settings);

		const updated = await ctx.prisma.user.update({
			where: { uid: ctx.user.uid },
			data: { status: UserStatus.CONFIRMED }
		});

		if (settings?.confirmTemplate) {
			await sendTemplatedEmail(
				user.email,
				{ subject: settings.confirmSubject, body: settings.confirmTemplate },
				buildTemplateVars(user, settings)
			).catch(() => {
				/* fire-and-forget */
			});
		}

		return updated;
	}),

	/**
	 * Decline RSVP — release spot after being accepted
	 *
	 * Accepted after the RSVP deadline too; see `assertBeforeRSVPDeadline` for why the
	 * two halves of the RSVP are not gated the same way.
	 */
	rsvpDecline: authedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid }
		});

		if (user.activeDecision !== DecisionStatus.ACCEPTED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'You must be accepted before you can decline.'
			});
		}

		if (user.status === UserStatus.DECLINED) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You have already declined.' });
		}

		const updated = await ctx.prisma.user.update({
			where: { uid: ctx.user.uid },
			data: { status: UserStatus.DECLINED }
		});

		const settings = await ctx.prisma.settings.findFirst();
		if (settings?.declineTemplate) {
			await sendTemplatedEmail(
				user.email,
				{ subject: settings.declineSubject, body: settings.declineTemplate },
				buildTemplateVars(user, settings)
			).catch(() => {
				/* fire-and-forget */
			});
		}

		return updated;
	}),

	/**
	 * Submit the application
	 */
	submit: authedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid }
		});
		const settings = await ctx.prisma.settings.findFirst();

		if (user.status !== UserStatus.CREATED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Application has already been submitted.'
			});
		}

		assertWithinApplicationWindow(settings);

		// Validate all required questions are answered
		const userRoles = user.roles;
		const questions = await ctx.prisma.question.findMany({
			where: {
				required: true,
				OR: [
					{ targetRole: { isEmpty: true } },
					...(userRoles.length ? [{ targetRole: { hasSome: userRoles } }] : [])
				]
			}
		});

		const responses = await ctx.prisma.applicationResponse.findMany({
			where: { userId: ctx.user.uid }
		});

		const answeredIds = new Set(responses.map((r) => r.questionId));
		const unanswered = questions.filter((q) => !answeredIds.has(q.id));

		if (unanswered.length > 0) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Please answer all required questions. Missing: ${unanswered.map((q) => q.title).join(', ')}`
			});
		}

		// Blacklist check.
		//
		// Only an exact email match auto-rejects. A blacklisted *name* is a heuristic --
		// `admissions.list` matches names tolerantly enough to catch misspellings -- so it is
		// surfaced as a flag for a human reviewer there and deliberately decides nothing here.
		// A typo must never cost someone their application.
		const blacklistedEmail = await ctx.prisma.blacklist.findUnique({
			where: { email: normalizeEmail(user.email) },
			select: { id: true }
		});

		// Update user status and optionally set pendingDecision
		const updatedUser = await ctx.prisma.user.update({
			where: { uid: ctx.user.uid },
			data: {
				status: UserStatus.APPLIED,
				...(blacklistedEmail && { pendingDecision: DecisionStatus.REJECTED })
			}
		});

		// Send confirmation email
		if (settings?.submitTemplate) {
			await sendTemplatedEmail(
				user.email,
				{ subject: settings.submitSubject, body: settings.submitTemplate },
				buildTemplateVars(user, settings)
			).catch(() => {
				/* fire-and-forget */
			});
		}

		return updatedUser;
	})
});
