import { z } from 'zod';
import { Role, QuestionType, LinkedField, OptionPreset } from '$lib/generated/prisma/client';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { logAction } from '$lib/server/log';
import { applicationFileKey } from '$lib/server/applicationFiles';
import { deleteObject, storageConfigured } from '$lib/server/storage';

/**
 * Removes the uploaded files for questions about to be deleted. The DB cascade drops
 * the response rows but knows nothing about the bucket.
 *
 * Inputs:
 * - prisma: PrismaClient
 * - questionIds: string[] — questions whose FILE responses should be cleared
 *
 * Side effects:
 * - Deletes objects from storage. Best-effort: failures are logged, never thrown, so a
 *   bucket outage can't block editing the form.
 */
async function deleteFilesForQuestions(prisma: PrismaClient, questionIds: string[]): Promise<void> {
	if (questionIds.length === 0 || !storageConfigured()) return;

	try {
		const responses = await prisma.applicationResponse.findMany({
			where: { questionId: { in: questionIds }, question: { type: QuestionType.FILE } },
			select: { userId: true, questionId: true }
		});

		await Promise.all(
			responses.map((response) => {
				const key = applicationFileKey(response.userId, response.questionId);
				return deleteObject(key).catch((error: unknown) =>
					console.error(
						`[storage] Orphaned ${key} — the question was deleted but the file ` +
							`could not be: ${(error as Error).message}`
					)
				);
			})
		);
	} catch (error) {
		console.error(
			`[storage] Could not clean up files for deleted question(s) ${questionIds.join(', ')}: ` +
				`${(error as Error).message}`
		);
	}
}

// `.nullish()`, not `.optional()`: the editor posts back rows as Prisma returned them,
// with `null` in the nullable columns, and `null` is also what clears a column.
const questionInput = z.object({
	title: z.string().min(1),
	type: z.nativeEnum(QuestionType),
	order: z.number().int().default(0),
	required: z.boolean().default(false),
	targetRole: z.array(z.nativeEnum(Role)).default([]),
	placeholder: z.string().nullish(),
	options: z.array(z.string()).default([]),
	min: z.number().nullish(),
	max: z.number().nullish(),
	regex: z.string().nullish(),
	// Used as a computed key into a `User` update; a free-form string would let a typo
	// save a question that writes nowhere.
	linkedField: z.nativeEnum(LinkedField).nullish(),
	optionPreset: z.nativeEnum(OptionPreset).nullish()
});

export const questionsRouter = router({
	// The application form. Authed and bounded to applicant audiences so `regex` /
	// `linkedField` internals and staff-only questions never reach the public.
	list: authedProcedure
		.input(z.object({ role: z.nativeEnum(Role).optional() }))
		.query(async ({ ctx, input }) => {
			// `role` comes from the client and the enum includes staff roles, so clamp it;
			// otherwise `list({ role: 'ADMIN' })` returns the staff-only questions.
			const audience =
				input.role && APPLICANT_ROLES.includes(input.role) ? [input.role] : APPLICANT_ROLES;
			return ctx.prisma.question.findMany({
				where: {
					OR: [{ targetRole: { isEmpty: true } }, { targetRole: { hasSome: audience } }]
				},
				orderBy: { order: 'asc' }
			});
		}),

	listAll: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.question.findMany({ orderBy: { order: 'asc' } });
	}),

	create: adminProcedure.input(questionInput).mutation(async ({ ctx, input }) => {
		const question = await ctx.prisma.question.create({ data: input });

		await logAction(ctx, {
			action: 'question.create',
			summary: `Added the question "${question.title}"`,
			target: { id: question.id, label: question.title },
			metadata: { type: question.type, required: question.required }
		});

		return question;
	}),

	update: adminProcedure
		.input(z.object({ id: z.string() }).merge(questionInput))
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			const before = await ctx.prisma.question.findUniqueOrThrow({
				where: { id },
				select: { title: true }
			});

			const question = await ctx.prisma.question.update({ where: { id }, data });

			await logAction(ctx, {
				action: 'question.update',
				summary: `Edited the question "${question.title}"`,
				target: { id: question.id, label: question.title },
				// Renames make old responses hard to interpret, so keep the previous title.
				metadata: { titleFrom: before.title, type: question.type }
			});

			return question;
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		// Before the delete: the responses naming the files cascade away with it.
		await deleteFilesForQuestions(ctx.prisma, [input.id]);

		const question = await ctx.prisma.question.delete({ where: { id: input.id } });

		await logAction(ctx, {
			action: 'question.delete',
			// This is the entry someone reads when applicant answers go missing.
			summary: `Deleted the question "${question.title}" and its responses`,
			target: { id: question.id, label: question.title },
			metadata: { type: question.type }
		});

		return question;
	}),

	reorder: adminProcedure
		.input(z.array(z.object({ id: z.string(), order: z.number().int() })))
		.mutation(async ({ ctx, input }) => {
			await ctx.prisma.$transaction(
				input.map((item) =>
					ctx.prisma.question.update({
						where: { id: item.id },
						data: { order: item.order }
					})
				)
			);

			await logAction(ctx, {
				action: 'question.reorder',
				summary: `Reordered ${input.length} application questions`,
				metadata: { count: input.length }
			});

			return { success: true };
		}),

	change: adminProcedure
		.input(
			z.object({
				deleted: z.array(z.object({ id: z.string() })).default([]),
				modified: z.array(z.object({ id: z.string() }).merge(questionInput)).default([]),
				added: z.array(questionInput).default([]),
				reordered: z.array(z.object({ id: z.string(), order: z.number().int() })).default([])
			})
		)
		.mutation(async ({ ctx, input }) => {
			// Resolved before the transaction removes them, so the audit row can name them.
			const deletedTitles =
				input.deleted.length > 0
					? (
							await ctx.prisma.question.findMany({
								where: { id: { in: input.deleted.map((q) => q.id) } },
								select: { title: true }
							})
						).map((q) => q.title)
					: [];

			// Outside the transaction: S3 has no rollback, so an aborted transaction would
			// leave the question standing with its file gone.
			await deleteFilesForQuestions(
				ctx.prisma,
				input.deleted.map((q) => q.id)
			);

			await ctx.prisma.$transaction(async (tx) => {
				for (const q of input.deleted) {
					await tx.question.delete({ where: { id: q.id } });
				}
				for (const q of input.modified) {
					const { id, ...data } = q;
					await tx.question.update({ where: { id }, data });
				}
				for (const q of input.added) {
					await tx.question.create({ data: q });
				}
				for (const q of input.reordered) {
					await tx.question.update({
						where: { id: q.id },
						data: { order: q.order }
					});
				}
			});

			// One entry per save, not per question, or a single click buries the feed.
			const parts = [
				input.added.length && `${input.added.length} added`,
				input.modified.length && `${input.modified.length} edited`,
				input.deleted.length && `${input.deleted.length} deleted`,
				input.reordered.length && `${input.reordered.length} reordered`
			].filter(Boolean) as string[];

			await logAction(ctx, {
				action: 'question.batch',
				summary: `Saved the application form (${parts.length > 0 ? parts.join(', ') : 'no changes'})`,
				metadata: {
					added: input.added.map((q) => q.title),
					modified: input.modified.map((q) => q.title),
					deleted: deletedTitles,
					reordered: input.reordered.length
				}
			});

			return { success: true };
		})
});
