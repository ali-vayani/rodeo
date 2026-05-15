import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { createLog } from '$lib/server/log';

export const scanRouter = router({
	scanUser: adminProcedure
		.input(
			z.object({
				userCode: z.string().min(1),
				action: z.string().min(1)
			})
		)
		.mutation(async ({ ctx, input }) => {
			// Validate action exists in settings
			const settings = await ctx.prisma.settings.findFirst();
			if (settings && !settings.scanActions.includes(input.action)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Invalid scan action "${input.action}". Valid actions: ${settings.scanActions.join(', ')}`
				});
			}

			// Find user by uid or by code prefix
			const user = await ctx.prisma.user.findFirst({
				where: {
					OR: [{ uid: input.userCode }, { uid: { endsWith: input.userCode.replace(/^RC-/i, '') } }]
				}
			});

			if (!user) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
			}

			// Check for duplicate scan today
			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);

			const duplicate = await ctx.prisma.scan.findFirst({
				where: {
					userId: user.uid,
					action: input.action,
					timestamp: { gte: startOfDay }
				}
			});

			const scan = await ctx.prisma.scan.create({
				data: { userId: user.uid, action: input.action },
				include: { user: true }
			});

			await createLog(ctx.prisma, `Scanned ${user.name} for "${input.action}"`, ctx.user.uid);

			return { scan, user, isDuplicate: !!duplicate };
		}),

	getRecent: adminProcedure
		.input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.scan.findMany({
				take: input.limit,
				orderBy: { timestamp: 'desc' },
				include: { user: true }
			});
		}),

	getHistory: adminProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.scan.findMany({
				where: { userId: input.userId },
				orderBy: { timestamp: 'desc' }
			});
		})
});
