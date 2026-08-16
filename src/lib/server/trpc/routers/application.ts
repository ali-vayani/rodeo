import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { LinkedField, OptionPreset } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus, QuestionType, Role } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { normalizeEmail } from '$lib/blacklist/match';
import { LINKED_FIELD_COLUMN, isLinkedField } from '$lib/linkedFields';
import { acceptsWriteIn, isOptionsType } from '$lib/questions/options';
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

/** The subset of a Question this router validates an answer against. */
type AnswerableQuestion = {
	linkedField: LinkedField | null;
	targetRole: Role[];
	type: QuestionType;
	options: string[];
	optionPreset: OptionPreset | null;
	min: number | null;
	max: number | null;
	regex: string | null;
};

/**
 * Validate a non-empty answer against its question definition.
 *
 * The client renders these constraints, but a direct tRPC call bypasses the browser
 * entirely — so `type`, `options`, `min`/`max`, and `regex` have to be enforced here
 * too or a reviewer ends up looking at a NUMBER field holding "potato" or a dropdown
 * answer that was never one of the offered options. Empty values are handled by the
 * caller (a blank draft field is allowed; a blank *required* answer is caught at submit).
 */
function assertAnswerValid(question: AnswerableQuestion, value: string) {
	if (question.type === QuestionType.NUMBER) {
		const n = Number(value);
		if (!Number.isFinite(n)) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'This question expects a number.' });
		}
		if (question.min != null && n < question.min) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `Must be at least ${question.min}.` });
		}
		if (question.max != null && n > question.max) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `Must be at most ${question.max}.` });
		}
	}

	// Single-select answers must be one of the offered options — unless the choices came
	// from a preset, which is a vocabulary rather than a constraint. See `acceptsWriteIn`.
	if (
		isOptionsType(question.type) &&
		!acceptsWriteIn(question) &&
		question.options.length > 0 &&
		!question.options.includes(value)
	) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'That is not one of the choices.' });
	}

	if (question.regex) {
		let re: RegExp;
		try {
			re = new RegExp(question.regex);
		} catch {
			// A malformed pattern stored on the question is not the applicant's fault —
			// don't block them on it.
			return;
		}
		if (!re.test(value)) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'That answer is not in the expected format.'
			});
		}
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
				questionId: z.string().min(1),
				// Bounded so an answer can't be used to store megabytes — the value flows
				// into admin tables, the CSV export, and (via linkedField) User.name.
				value: z.string().max(10_000)
			})
		)
		.mutation(async ({ ctx, input }) => {
			// This runs on every field blur, so the two gate reads go out together rather
			// than in series. `ctx.user` is not trusted for status: it was loaded when the
			// request arrived, and a decision may have landed since.
			const [user, settings] = await Promise.all([
				ctx.prisma.user.findUniqueOrThrow({
					where: { uid: ctx.user.uid },
					select: { status: true, role: true }
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
				select: {
					linkedField: true,
					targetRole: true,
					type: true,
					options: true,
					optionPreset: true,
					min: true,
					max: true,
					regex: true
				}
			})) as AnswerableQuestion | null;

			// A missing question would otherwise fall through to an upsert that violates the
			// FK and surfaces as a 500. Reject it as a clean NOT_FOUND instead.
			if (!question) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'That question does not exist.' });
			}

			// Don't let an applicant answer a question aimed at a different audience: those
			// answers would show up in their admissions detail as if they'd been asked.
			if (question.targetRole.length > 0 && !question.targetRole.includes(user.role)) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'This question was not asked of you.' });
			}

			// Constraints apply to real answers only — a blank draft field is allowed.
			if (input.value.trim() !== '') {
				assertAnswerValid(question, input.value);
			}

			// Write through to the user record for linked fields. The allowlist lives in
			// `$lib/linkedFields` because the admin filter panels derive their vocabulary
			// from the same three columns — an inline copy here is what stopped anything
			// else from reusing it.
			if (isLinkedField(question.linkedField)) {
				await ctx.prisma.user.update({
					where: { uid: ctx.user.uid },
					data: { [LINKED_FIELD_COLUMN[question.linkedField]]: input.value }
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

		if (user.status === UserStatus.CHECKED_IN) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already checked in.' });
		}

		// Declining releases the spot permanently — the confirm dialog says as much. A
		// DECLINED user re-confirming is exactly the post-release headcount growth the
		// deadline exists to prevent, so it is refused before *and* after the deadline.
		if (user.status === UserStatus.DECLINED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message:
					'You released your spot and can no longer RSVP. Contact the organizers if you still plan to attend.'
			});
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

		// A checked-in attendee tapping decline would erase their check-in with no audit
		// trail and, past the RSVP deadline, could never re-confirm. They are physically
		// here — refuse the downgrade.
		if (user.status === UserStatus.CHECKED_IN) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'You are already checked in and cannot decline.'
			});
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
	 *
	 * `role` is the audience the applicant filled the form out as (Hacker/Judge/Mentor/
	 * Volunteer). The page renders questions for the selected role, so submission has to
	 * persist it — otherwise a self-registered account stays `[HACKER]` and `submit`
	 * validates the wrong required set, dead-ending anyone who applied as anything else.
	 */
	submit: authedProcedure
		.input(z.object({ role: z.nativeEnum(Role).optional() }).optional())
		.mutation(async ({ ctx, input }) => {
			// Only an applicant role may be submitted as — never staff. A bad or staff role
			// is ignored rather than rejected, falling back to the user's stored role.
			// This is the one place an account's role changes without an admin, which is
			// why the staff roles are unreachable through it: submitting `role: "ADMIN"`
			// must not be a privilege escalation.
			const submittedRole =
				input?.role && APPLICANT_ROLES.includes(input.role) ? input.role : undefined;

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

			// The role the applicant is submitting as decides which required questions apply
			// and is written onto the user below. Falls back to their stored role when the
			// client sends nothing, so older callers keep working.
			const applicationRole = submittedRole ?? user.role;

			// Validate all required questions are answered
			const questions = await ctx.prisma.question.findMany({
				where: {
					required: true,
					OR: [{ targetRole: { isEmpty: true } }, { targetRole: { has: applicationRole } }]
				}
			});

			const responses = await ctx.prisma.applicationResponse.findMany({
				where: { userId: ctx.user.uid }
			});

			// A response row with a blank value is not an answer. Building the set from row
			// existence alone let an applicant satisfy every required question by saving ""
			// (autosave fires on each keystroke, including the one that clears the field).
			const answeredIds = new Set(
				responses.filter((r) => r.value.trim() !== '').map((r) => r.questionId)
			);
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

			// Compare-and-swap on status: the guard above read CREATED, but two rapid submits
			// would both pass it and both send the confirmation email. Gating the write on
			// `status: CREATED` means only the first transitions the row; the loser sees
			// count 0 and is told it's already in, mailing nothing twice.
			const applied = await ctx.prisma.user.updateMany({
				where: { uid: ctx.user.uid, status: UserStatus.CREATED },
				data: {
					status: UserStatus.APPLIED,
					role: applicationRole,
					...(blacklistedEmail && { pendingDecision: DecisionStatus.REJECTED })
				}
			});

			if (applied.count === 0) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Application has already been submitted.'
				});
			}

			const updatedUser = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

			// Send confirmation email
			if (settings?.submitTemplate) {
				await sendTemplatedEmail(
					user.email,
					{ subject: settings.submitSubject, body: settings.submitTemplate },
					buildTemplateVars(updatedUser, settings)
				).catch(() => {
					/* fire-and-forget */
				});
			}

			return updatedUser;
		})
});
