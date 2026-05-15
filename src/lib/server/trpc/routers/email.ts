import { z } from 'zod';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { sendEmail } from '$lib/server/email';

export const emailRouter = router({
	sendCustom: adminProcedure
		.input(
			z.object({
				subject: z.string().min(1),
				body: z.string().min(1),
				filters: z.object({
					roles: z.array(z.nativeEnum(Role)).optional(),
					statuses: z.array(z.nativeEnum(UserStatus)).optional(),
					decisions: z.array(z.nativeEnum(DecisionStatus)).optional()
				})
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { subject, body, filters } = input;

			const users = await ctx.prisma.user.findMany({
				where: {
					...(filters.roles?.length && { roles: { hasSome: filters.roles } }),
					...(filters.statuses?.length && { status: { in: filters.statuses } }),
					...(filters.decisions?.length && { activeDecision: { in: filters.decisions } })
				}
			});

			if (users.length === 0) {
				return { sent: 0 };
			}

			await Promise.allSettled(
				users.map((u) => sendEmail({ to: u.email, subject, body }))
			);

			await ctx.prisma.emailLog.create({
				data: {
					subject,
					body,
					userIds: users.map((u) => u.uid),
					sentAt: new Date()
				}
			});

			return { sent: users.length };
		}),

	getLogs: adminProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(100).default(20)
			})
		)
		.query(async ({ ctx, input }) => {
			const [total, logs] = await Promise.all([
				ctx.prisma.emailLog.count(),
				ctx.prisma.emailLog.findMany({
					skip: (input.page - 1) * input.pageSize,
					take: input.pageSize,
					orderBy: { sentAt: 'desc' }
				})
			]);

			return { logs, total, page: input.page, pageSize: input.pageSize };
		})
});
