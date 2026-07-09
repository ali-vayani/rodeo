import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { createLog } from '$lib/server/log';
import { Role, UserStatus, type PrismaClient } from '$lib/generated/prisma/client';

// Shared by `lookup` below; `scanUser` keeps its own inline logic unchanged.
async function assertValidAction(prisma: PrismaClient, action: string): Promise<void> {
	const settings = await prisma.settings.findFirst();
	if (settings && !settings.scanActions.includes(action)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid scan action "${action}". Valid actions: ${settings.scanActions.join(', ')}`
		});
	}
}

async function resolveUserByCode(prisma: PrismaClient, userCode: string) {
	const user = await prisma.user.findFirst({
		where: {
			OR: [{ uid: userCode }, { uid: { endsWith: userCode.replace(/^RC-/i, '') } }]
		}
	});
	if (!user) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
	}
	return user;
}

async function isDuplicateToday(
	prisma: PrismaClient,
	userId: string,
	action: string
): Promise<boolean> {
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);

	const duplicate = await prisma.scan.findFirst({
		where: { userId, action, timestamp: { gte: startOfDay } }
	});

	return !!duplicate;
}

export const scanRouter = router({
	lookup: adminProcedure
		.input(
			z.object({
				userCode: z.string().min(1),
				action: z.string().min(1)
			})
		)
		.query(async ({ ctx, input }) => {
			await assertValidAction(ctx.prisma, input.action);
			const user = await resolveUserByCode(ctx.prisma, input.userCode);

			const [isDuplicate, scanCountForAction] = await Promise.all([
				isDuplicateToday(ctx.prisma, user.uid, input.action),
				ctx.prisma.scan.count({ where: { userId: user.uid, action: input.action } })
			]);

			const isUnconfirmedHacker =
				user.roles.includes(Role.HACKER) &&
				user.status !== UserStatus.CONFIRMED &&
				user.status !== UserStatus.CHECKED_IN;

			return {
				user,
				isDuplicate,
				scanCountForAction,
				warning: isUnconfirmedHacker ? ('UNCONFIRMED_HACKER' as const) : null
			};
		}),

	getCounts: adminProcedure.query(async ({ ctx }) => {
		const [settings, grouped] = await Promise.all([
			ctx.prisma.settings.findFirst(),
			ctx.prisma.scan.groupBy({ by: ['action'], _count: { action: true } })
		]);
		const actions = settings?.scanActions ?? ['Check-In'];

		const counts: Record<string, number> = {};
		for (const action of actions) counts[action] = 0;
		// Also surfaces retired actions with historical scans that are no longer in settings — intentional.
		for (const row of grouped) counts[row.action] = row._count.action;

		return counts;
	}),

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
