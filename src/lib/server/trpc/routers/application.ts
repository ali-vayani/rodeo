import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { LinkedField, OptionPreset } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus, QuestionType, Role } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { normalizeEmail } from '$lib/blacklist/match';
import { LINKED_FIELD_COLUMN, isLinkedField } from '$lib/linkedFields';
import { acceptsWriteIn, isOptionsType } from '$lib/questions/options';
import { decodeMultiSelect } from '$lib/questions/multiSelect';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { emailSettings } from '$lib/server/settings';
import { formatDateLong } from '$lib/format';

/**
 * Report a lifecycle send that failed, without failing the mutation behind it.
 *
 * These sends must not throw into the caller — an RSVP that reported failure because
 * Resend was briefly down would tell a hacker their spot wasn't held. Logged rather
 * than dropped, so a silent outage is findable.
 */
function reportSendFailure(kind: string, to: string) {
	return (error: unknown) => {
		console.error(`[email] ${kind} notification to ${to} failed to send:`, error);
	};
}

/**
 * The three columns that gate everything in this router. Structurally typed so a
 * Prisma `Settings` row passes and the guards can be exercised on a literal.
 */
type ApplicationWindow = {
	applicationOpen: Date;
	applicationDeadline: Date;
	RSVPDeadline: Date;
};

/**
 * A missing Settings row opens the gate rather than closing it.
 *
 * A fresh install has no window, so reading "unconfigured" as "closed" would lock
 * applicants out of an event nobody has set up yet. One save of /admin/settings turns
 * enforcement on.
 *
 * Applicant-facing only — `admissions.setDecision` is deliberately unaffected, so
 * closing applications doesn't also stop organizers working through the ones already in.
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
 * The deadline exists to freeze the confirmed headcount. A late confirmation grows
 * that number after it was frozen; a late decline only shrinks it, and refusing one
 * would hold a spot for someone who has just said they aren't coming. The asymmetry
 * is one-way: a hacker who declines late cannot re-confirm.
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
	allowOther: boolean;
	min: number | null;
	max: number | null;
	regex: string | null;
};

/**
 * Validate a non-empty answer against its question definition.
 *
 * The client renders these constraints, but a direct tRPC call bypasses the browser —
 * so `type`, `options`, `min`/`max` and `regex` are enforced here too. Empty values are
 * handled by the caller: a blank draft field is allowed, a blank required answer is
 * caught at submit.
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

	// The same rule over a set. A non-empty value that decodes to nothing is malformed
	// rather than empty — the caller already let real blanks through — and storing it
	// would leave an answer no reader could interpret.
	if (question.type === QuestionType.MULTI_SELECT) {
		const chosen = decodeMultiSelect(value);
		if (chosen.length === 0) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'That is not a valid selection.' });
		}
		if (new Set(chosen).size !== chosen.length) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'That selection repeats a choice.' });
		}

		const offList = chosen.filter((c) => !question.options.includes(c));
		// `allowOther` buys exactly one write-in, the one the "Other" box holds. Several
		// means a hand-built payload, and storing them would show only the first back.
		const allowed = question.allowOther ? 1 : 0;
		if (question.options.length > 0 && offList.length > allowed) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'That is not one of the choices.' });
		}
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

/**
 * Whether a stored response counts as an answer to a required question.
 *
 * A blank value never does: autosave writes a row as soon as a field is touched, so
 * presence of the row let an applicant satisfy every required question by saving "".
 *
 * A CHECKBOX needs the second clause. Clearing one autosaves the string 'false', which
 * is not blank — so the required consent boxes (MLH data sharing, code of conduct, food
 * allergy waiver) passed submit while unticked, which is the opposite of what a consent
 * gate is for.
 *
 * A MULTI_SELECT clears to '' and so is already caught above; the third clause is for
 * an unreadable value, which is no more an answer than a blank one.
 */
function isAnswered(type: QuestionType, value: string | undefined): boolean {
	if (value === undefined || value.trim() === '') return false;
	if (type === QuestionType.CHECKBOX) return value === 'true';
	if (type === QuestionType.MULTI_SELECT) return decodeMultiSelect(value).length > 0;
	return true;
}

export const applicationRouter = router({
	/** Get all responses for the current user. */
	getMyResponses: authedProcedure.query(async ({ ctx }) => {
		return ctx.prisma.applicationResponse.findMany({
			where: { userId: ctx.user.uid },
			include: { question: true }
		});
	}),

	/**
	 * Save a response for a question.
	 *
	 * Writable only while the application is still CREATED, and only inside the
	 * application window. Once submitted, the answers are what an admin decided on —
	 * and an upsert here writes no audit entry, so a later edit would be invisible.
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
			// This runs on every field blur, so the two gate reads go out together. `ctx.user`
			// is not trusted for status: a decision may have landed since the request arrived.
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
					allowOther: true,
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

			// Accepting a string here would let a caller satisfy a required file question by
			// naming a file, with nothing in the bucket. Uploads have their own endpoint.
			if (question.type === QuestionType.FILE) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'File answers are uploaded, not saved as text.'
				});
			}

			// Constraints apply to real answers only — a blank draft field is allowed.
			if (input.value.trim() !== '') {
				assertAnswerValid(question, input.value);
			}

			// Write through to the user record for linked fields. The allowlist lives in
			// `$lib/linkedFields` because the admin filter panels share the same three columns.
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

	/** RSVP — confirm attendance after being accepted. */
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

		// Declining releases the spot permanently. A DECLINED user re-confirming is the
		// post-release headcount growth the deadline exists to prevent, so it is always refused.
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

		// Defaults when no row exists — an unconfigured install still confirms an RSVP.
		// A template an admin has deliberately blanked still opts out.
		const mail = emailSettings(settings);
		if (mail.confirmTemplate) {
			// The RSVP confirmation is where a hacker wants their pass, so this send carries the
			// check-in block. Personalization takes the raw row so the wallet gate fails closed.
			const { vars, attachments } = await buildEmailPersonalization(updated, settings);
			await sendTemplatedEmail(
				user.email,
				{ subject: mail.confirmSubject, body: mail.confirmTemplate },
				vars,
				attachments
			).catch(reportSendFailure('RSVP confirmation', user.email));
		}

		return updated;
	}),

	/**
	 * Decline RSVP — release spot after being accepted.
	 *
	 * Accepted after the RSVP deadline too; see `assertBeforeRSVPDeadline` for why.
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

		// A checked-in attendee tapping decline would erase their check-in and, past the
		// deadline, could never re-confirm. They are physically here — refuse the downgrade.
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
		const mail = emailSettings(settings);
		if (mail.declineTemplate) {
			await sendTemplatedEmail(
				user.email,
				{ subject: mail.declineSubject, body: mail.declineTemplate },
				// Vars only: a declined account has no check-in block, so there is no
				// attachment to carry.
				(await buildEmailPersonalization(user, settings)).vars
			).catch(reportSendFailure('RSVP decline', user.email));
		}

		return updated;
	}),

	/**
	 * Submit the application.
	 *
	 * `role` is the audience the applicant filled the form out as. The page renders
	 * questions for the selected role, so submission has to persist it — otherwise a
	 * self-registered account stays `[HACKER]` and `submit` validates the wrong required set.
	 */
	submit: authedProcedure
		.input(z.object({ role: z.nativeEnum(Role).optional() }).optional())
		.mutation(async ({ ctx, input }) => {
			// Only an applicant role may be submitted as — never staff. A bad or staff role
			// falls back to the user's stored role rather than being rejected. This is the one
			// place a role changes without an admin, so `role: "ADMIN"` must be unreachable.
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

			// Decides which required questions apply, and is written onto the user below.
			// Falls back to their stored role so older callers keep working.
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

			const answers = new Map(responses.map((r) => [r.questionId, r.value]));
			const unanswered = questions.filter((q) => !isAnswered(q.type, answers.get(q.id)));

			if (unanswered.length > 0) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Please answer all required questions. Missing: ${unanswered.map((q) => q.title).join(', ')}`
				});
			}

			// Only an exact email match auto-rejects. A blacklisted *name* is a heuristic —
			// surfaced as a flag for a human reviewer in `admissions.list` — because a typo must
			// never cost someone their application.
			const blacklistedEmail = await ctx.prisma.blacklist.findUnique({
				where: { email: normalizeEmail(user.email) },
				select: { id: true }
			});

			// Compare-and-swap on status: the guard above read CREATED, but two rapid submits
			// would both pass it and both send the confirmation email. Only the first transitions
			// the row; the loser sees count 0 and is told it's already in.
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

			// Defaults when no Settings row exists — the window guards read that as
			// "unconfigured, allow through", and an application allowed through gets acknowledged.
			const mail = emailSettings(settings);
			if (mail.submitTemplate) {
				const { vars, attachments } = await buildEmailPersonalization(updatedUser, settings);
				await sendTemplatedEmail(
					user.email,
					{ subject: mail.submitSubject, body: mail.submitTemplate },
					vars,
					attachments
				).catch(reportSendFailure('application submitted', user.email));
			}

			return updatedUser;
		})
});
