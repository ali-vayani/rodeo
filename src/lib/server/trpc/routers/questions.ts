import { z } from 'zod';
import { Role, QuestionType } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { logAction } from '$lib/server/log';

// `placeholder`, `min`, `max`, `regex` and `linkedField` are nullable columns, so
// Prisma hands them back as `null`. The application editor loads a question, round-
// trips it through JSON untouched and posts it back — and zod's `.optional()` accepts
// only `undefined`, so every save containing an added or modified question was
// rejected with "expected string, received null". `.nullish()` accepts both, and
// `null` is exactly what Prisma wants for "clear this column" on create and update
// alike, so the parsed value can go straight through.
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
	linkedField: z.string().nullish()
});

export const questionsRouter = router({
	// The application form. `authedProcedure`, not public: with no role it used to return
	// every Question to anyone — the same rows `listAll` guards behind admin — including
	// `regex`/`linkedField` internals and staff-audience questions. Now it is gated, and
	// bounded to applicant-audience (or untargeted) questions so a hacker can pick which
	// role to apply as without ever seeing an ORGANIZER/ADMIN-only question.
	list: authedProcedure
		.input(z.object({ role: z.nativeEnum(Role).optional() }))
		.query(async ({ ctx, input }) => {
			const audience = input.role ? [input.role] : APPLICANT_ROLES;
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
				// Renames are the edit that makes old responses hard to interpret, so
				// the previous title is worth keeping even when nothing else changed.
				metadata: { titleFrom: before.title, type: question.type }
			});

			return question;
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const question = await ctx.prisma.question.delete({ where: { id: input.id } });

		await logAction(ctx, {
			action: 'question.delete',
			// Deleting a question cascades its responses. Say so in the trail —
			// this is the entry someone reads when applicant answers go missing.
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
			// Resolve the deleted titles before the transaction removes them — an
			// audit row reading "deleted 2 questions" is far less useful than one
			// naming them, and after the commit there is nothing left to name.
			const deletedTitles =
				input.deleted.length > 0
					? (
							await ctx.prisma.question.findMany({
								where: { id: { in: input.deleted.map((q) => q.id) } },
								select: { title: true }
							})
						).map((q) => q.title)
					: [];

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

			// One entry per save, not one per question: the editor commits the whole
			// form at once, and a trail of twelve rows for a single click buries
			// everything else in the feed.
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
