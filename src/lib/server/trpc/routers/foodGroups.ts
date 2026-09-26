import { z } from 'zod';
import { FoodGroupPool, UserStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { splitFoodPool, foodPoolFor } from '$lib/food/groups';

const eligibleStatuses = [UserStatus.CONFIRMED, UserStatus.CHECKED_IN];

export const foodGroupsRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		const [groups, dietaryCount, eligibleCount] = await Promise.all([
			ctx.prisma.foodGroup.findMany({
				orderBy: [{ pool: 'asc' }, { name: 'asc' }],
				include: {
					members: {
						include: {
							user: { select: { uid: true, name: true, team: { select: { teamName: true } } } }
						},
						orderBy: { user: { name: 'asc' } }
					}
				}
			}),
			ctx.prisma.user.count({
				where: {
					status: { in: eligibleStatuses },
					dietaryRestriction: { isEmpty: false }
				}
			}),
			ctx.prisma.user.count({ where: { status: { in: eligibleStatuses } } })
		]);

		return {
			groups,
			pools: { dietary: dietaryCount, noRestriction: eligibleCount - dietaryCount }
		};
	}),

	generate: adminProcedure
		.input(
			z.object({
				dietaryGroupCount: z.number().int().min(0).max(50),
				noRestrictionGroupCount: z.number().int().min(0).max(50)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const users = await ctx.prisma.user.findMany({
				where: { status: { in: eligibleStatuses } },
				select: {
					uid: true,
					name: true,
					teamId: true,
					dietaryRestriction: true
				}
			});
			const dietary = users.filter(
				(user) => foodPoolFor(user.dietaryRestriction) === 'DIETARY_RESTRICTION'
			);
			const noRestriction = users.filter(
				(user) => foodPoolFor(user.dietaryRestriction) === 'NO_RESTRICTION'
			);

			const created = await ctx.prisma.$transaction(async (tx) => {
				await tx.foodGroup.deleteMany();
				const pools = [
					{
						pool: FoodGroupPool.DIETARY_RESTRICTION,
						users: dietary,
						count: input.dietaryGroupCount,
						label: 'Dietary group'
					},
					{
						pool: FoodGroupPool.NO_RESTRICTION,
						users: noRestriction,
						count: input.noRestrictionGroupCount,
						label: 'Food group'
					}
				];
				const results = [];
				for (const item of pools) {
					if (item.count === 0) continue;
					const assignments = splitFoodPool(item.users, item.count);
					for (const [index, members] of assignments.entries()) {
						results.push(
							await tx.foodGroup.create({
								data: {
									name: `${item.label} ${index + 1}`,
									pool: item.pool,
									members: { create: members.map((user) => ({ userId: user.uid })) }
								}
							})
						);
					}
				}
				return results;
			});

			await logAction(ctx, {
				action: 'food.groups.generate',
				summary: `Generated ${created.length} food groups for ${users.length} confirmed attendees`,
				metadata: {
					dietaryUsers: dietary.length,
					noRestrictionUsers: noRestriction.length,
					groups: created.length
				}
			});
			return { count: created.length };
		}),

	rename: adminProcedure
		.input(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(100) }))
		.mutation(async ({ ctx, input }) => {
			const group = await ctx.prisma.foodGroup.update({
				where: { id: input.id },
				data: { name: input.name }
			});
			await logAction(ctx, {
				action: 'food.groups.rename',
				summary: `Renamed a food group to "${group.name}"`,
				target: { id: group.id, label: group.name }
			});
			return group;
		}),

	/** Makes the current set of generated group assignments visible to attendees. */
	release: adminProcedure.mutation(async ({ ctx }) => {
		const releasedAt = new Date();
		const result = await ctx.prisma.foodGroup.updateMany({
			where: { releasedAt: null },
			data: { releasedAt }
		});
		await logAction(ctx, {
			action: 'food.groups.release',
			summary: `Released ${result.count} food groups to attendees`,
			metadata: { groups: result.count, releasedAt: releasedAt.toISOString() }
		});
		return { count: result.count, releasedAt };
	})
});
