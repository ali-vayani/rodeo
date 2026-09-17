import { z } from 'zod';
import { LunchGroupPool, UserStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { splitLunchPool, lunchPoolFor } from '$lib/lunch/groups';

const eligibleStatuses = [UserStatus.CONFIRMED, UserStatus.CHECKED_IN];

export const lunchGroupsRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		const [groups, dietaryCount, eligibleCount] = await Promise.all([
			ctx.prisma.lunchGroup.findMany({
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
				(user) => lunchPoolFor(user.dietaryRestriction) === 'DIETARY_RESTRICTION'
			);
			const noRestriction = users.filter(
				(user) => lunchPoolFor(user.dietaryRestriction) === 'NO_RESTRICTION'
			);

			const created = await ctx.prisma.$transaction(async (tx) => {
				await tx.lunchGroup.deleteMany();
				const pools = [
					{
						pool: LunchGroupPool.DIETARY_RESTRICTION,
						users: dietary,
						count: input.dietaryGroupCount,
						label: 'Dietary group'
					},
					{
						pool: LunchGroupPool.NO_RESTRICTION,
						users: noRestriction,
						count: input.noRestrictionGroupCount,
						label: 'Lunch group'
					}
				];
				const results = [];
				for (const item of pools) {
					if (item.count === 0) continue;
					const assignments = splitLunchPool(item.users, item.count);
					for (const [index, members] of assignments.entries()) {
						results.push(
							await tx.lunchGroup.create({
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
				action: 'lunch.groups.generate',
				summary: `Generated ${created.length} lunch groups for ${users.length} confirmed attendees`,
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
			const group = await ctx.prisma.lunchGroup.update({
				where: { id: input.id },
				data: { name: input.name }
			});
			await logAction(ctx, {
				action: 'lunch.groups.rename',
				summary: `Renamed a lunch group to "${group.name}"`,
				target: { id: group.id, label: group.name }
			});
			return group;
		}),

	/** Makes the current set of generated group assignments visible to attendees. */
	release: adminProcedure.mutation(async ({ ctx }) => {
		const releasedAt = new Date();
		const result = await ctx.prisma.lunchGroup.updateMany({
			where: { releasedAt: null },
			data: { releasedAt }
		});
		await logAction(ctx, {
			action: 'lunch.groups.release',
			summary: `Released ${result.count} lunch groups to attendees`,
			metadata: { groups: result.count, releasedAt: releasedAt.toISOString() }
		});
		return { count: result.count, releasedAt };
	})
});
