import { z } from 'zod';
import { Role, QuestionType, LinkedField, OptionPreset } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { logAction } from '$lib/server/log';

// These are nullable columns, so Prisma hands them back as `null`. The application
// editor round-trips a question through JSON untouched and posts it back, and zod's
// `.optional()` accepts only `undefined`, so every save containing a modified question
// was rejected with "expected string, received null". `.nullish()` accepts both, and
// `null` is what Prisma wants for "clear this column".
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
	// Was `z.string()`, which accepted anything. The value is used as a computed key into
	// a `User` update, so a typo produced a question that saved but wrote nowhere.
	linkedField: z.nativeEnum(LinkedField).nullish(),
	optionPreset: z.nativeEnum(OptionPreset).nullish()
});

export const questionsRouter = router({
	// The application form. `authedProcedure`, not public: with no role it used to return
	// every Question to anyone, including `regex`/`linkedField` internals and
	// staff-audience questions. Now bounded to applicant-audience questions.
	list: authedProcedure
		.input(z.object({ role: z.nativeEnum(Role).optional() }))
		.query(async ({ ctx, input }) => {
			// `input.role` lets an applicant preview a specific audience, but it arrives from the
			// client and `z.nativeEnum(Role)` accepts staff roles too, so it is clamped. Without
			// the clamp, `list({ role: 'ADMIN' })` returned the staff-only questions.
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
			// Resolve the deleted titles before the transaction removes them. An audit row
			// reading "deleted 2 questions" is far less useful than one naming them.
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

			// One entry per save, not one per question. The editor commits the whole form at
			// once, and twelve rows for a single click would bury everything else in the feed.
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
