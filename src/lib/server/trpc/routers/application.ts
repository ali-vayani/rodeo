import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { normalizeEmail } from '$lib/blacklist/match';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildTemplateVars } from '$lib/email/variables';

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

		if (user.activeDecision !== DecisionStatus.ACCEPTED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'You must be accepted before you can RSVP.'
			});
		}

		if (user.status === UserStatus.CONFIRMED) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: "You have already RSVP'd." });
		}

		const updated = await ctx.prisma.user.update({
			where: { uid: ctx.user.uid },
			data: { status: UserStatus.CONFIRMED }
		});

		const settings = await ctx.prisma.settings.findFirst();
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

		if (user.status !== UserStatus.CREATED) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Application has already been submitted.'
			});
		}

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
		const settings = await ctx.prisma.settings.findFirst();
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
