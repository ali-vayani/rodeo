import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';

// `id` is present when the editor posts back a row Prisma returned, absent on a new
// one. An unknown id is treated as new rather than trusted, so a stale or hand-edited
// payload cannot update another criterion's rows.
const levelInput = z.object({
	id: z.string().optional(),
	label: z.string().min(1).max(200),
	description: z.string().max(2000).default(''),
	points: z.number().int().min(0).max(1000)
});

const criterionInput = z.object({
	id: z.string().optional(),
	title: z.string().min(1).max(500),
	levels: z.array(levelInput).min(1).max(20)
});

export const rubricRouter = router({
	/** The whole rubric, criteria and levels in display order. `[]` means none defined. */
	get: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.rubricCriterion.findMany({
			orderBy: { order: 'asc' },
			include: { levels: { orderBy: { order: 'asc' } } }
		});
	}),

	/**
	 * Replaces the rubric with the posted grid, reconciling by id: kept rows are updated
	 * in place so existing applicant selections survive a wording or point tweak; removed
	 * rows cascade their selections away. Saved applicant totals are never recomputed —
	 * they froze at save time.
	 */
	save: adminProcedure
		.input(z.object({ criteria: z.array(criterionInput).max(50) }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.prisma.rubricCriterion.findMany({
				select: { id: true, levels: { select: { id: true } } }
			});
			const existingCriterionIds = new Set(existing.map((c) => c.id));
			const existingLevelIds = new Map(
				existing.map((c) => [c.id, new Set(c.levels.map((l) => l.id))])
			);

			await ctx.prisma.$transaction(async (tx) => {
				const keptCriteria = new Set(input.criteria.map((c) => c.id).filter(Boolean));
				const removed = existing.filter((c) => !keptCriteria.has(c.id)).map((c) => c.id);
				if (removed.length > 0) {
					await tx.rubricCriterion.deleteMany({ where: { id: { in: removed } } });
				}

				for (const [order, c] of input.criteria.entries()) {
					let criterionId: string;
					if (c.id && existingCriterionIds.has(c.id)) {
						criterionId = c.id;
						await tx.rubricCriterion.update({
							where: { id: criterionId },
							data: { title: c.title, order }
						});
					} else {
						criterionId = (await tx.rubricCriterion.create({ data: { title: c.title, order } })).id;
					}

					const knownLevels = existingLevelIds.get(criterionId) ?? new Set<string>();
					const keptLevels = new Set(c.levels.map((l) => l.id).filter(Boolean));
					const removedLevels = [...knownLevels].filter((id) => !keptLevels.has(id));
					if (removedLevels.length > 0) {
						await tx.rubricLevel.deleteMany({ where: { id: { in: removedLevels } } });
					}

					for (const [levelOrder, l] of c.levels.entries()) {
						const data = {
							label: l.label,
							description: l.description,
							points: l.points,
							order: levelOrder
						};
						if (l.id && knownLevels.has(l.id)) {
							await tx.rubricLevel.update({ where: { id: l.id }, data });
						} else {
							await tx.rubricLevel.create({ data: { ...data, criterionId } });
						}
					}
				}
			});

			await logAction(ctx, {
				action: 'admissions.rubric.save',
				summary: `Saved the scoring rubric (${input.criteria.length} ${
					input.criteria.length === 1 ? 'criterion' : 'criteria'
				})`,
				metadata: { criteria: input.criteria.map((c) => c.title) }
			});

			return ctx.prisma.rubricCriterion.findMany({
				orderBy: { order: 'asc' },
				include: { levels: { orderBy: { order: 'asc' } } }
			});
		})
});
