import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { isApplicantRole } from '$lib/admissions/roles';
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

const rubricInput = z.object({
	role: z.nativeEnum(Role),
	criteria: z.array(criterionInput).max(50)
});

export const rubricRouter = router({
	/** Every role's rubric in one list; group by `role` client-side. `[]` means none. */
	get: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.rubricCriterion.findMany({
			orderBy: { order: 'asc' },
			include: { levels: { orderBy: { order: 'asc' } } }
		});
	}),

	/**
	 * Replaces each posted role's rubric with its posted grid; roles not in the payload
	 * are untouched. Reconciles by id: kept rows are updated in place so existing
	 * applicant selections survive a wording or point tweak; removed rows cascade their
	 * selections away. Saved applicant totals are never recomputed — they froze at save
	 * time. A criterion never moves between roles: an id posted under a different role
	 * reads as unknown and creates a new row.
	 */
	save: adminProcedure
		.input(z.object({ rubrics: z.array(rubricInput).max(10) }))
		.mutation(async ({ ctx, input }) => {
			const roles = input.rubrics.map((r) => r.role);
			if (new Set(roles).size !== roles.length) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Each role may appear only once.' });
			}
			// Only applicants are scored; a staff rubric would be unreachable dead config.
			if (!roles.every(isApplicantRole)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Rubrics exist only for applicant roles.'
				});
			}

			const existing = await ctx.prisma.rubricCriterion.findMany({
				select: { id: true, role: true, levels: { select: { id: true } } }
			});
			const existingLevelIds = new Map(
				existing.map((c) => [c.id, new Set(c.levels.map((l) => l.id))])
			);

			await ctx.prisma.$transaction(async (tx) => {
				for (const { role, criteria } of input.rubrics) {
					const existingForRole = existing.filter((c) => c.role === role);
					const existingIds = new Set(existingForRole.map((c) => c.id));

					const kept = new Set(criteria.map((c) => c.id).filter(Boolean));
					const removed = existingForRole.filter((c) => !kept.has(c.id)).map((c) => c.id);
					if (removed.length > 0) {
						await tx.rubricCriterion.deleteMany({ where: { id: { in: removed } } });
					}

					for (const [order, c] of criteria.entries()) {
						let criterionId: string;
						if (c.id && existingIds.has(c.id)) {
							criterionId = c.id;
							await tx.rubricCriterion.update({
								where: { id: criterionId },
								data: { title: c.title, order }
							});
						} else {
							criterionId = (
								await tx.rubricCriterion.create({ data: { role, title: c.title, order } })
							).id;
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
				}
			});

			await logAction(ctx, {
				action: 'admissions.rubric.save',
				summary: `Saved the scoring rubrics (${input.rubrics
					.map((r) => `${r.criteria.length} ${r.role.toLowerCase()}`)
					.join(', ')})`,
				metadata: Object.fromEntries(
					input.rubrics.map((r) => [r.role, r.criteria.map((c) => c.title)])
				)
			});

			return ctx.prisma.rubricCriterion.findMany({
				orderBy: { order: 'asc' },
				include: { levels: { orderBy: { order: 'asc' } } }
			});
		})
});
