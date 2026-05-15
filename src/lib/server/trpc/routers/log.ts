import { z } from 'zod';
import { router, adminProcedure } from '../init';

export const logRouter = router({
	list: adminProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(200).default(50)
			})
		)
		.query(async ({ ctx, input }) => {
			const [total, entries] = await Promise.all([
				ctx.prisma.log.count(),
				ctx.prisma.log.findMany({
					skip: (input.page - 1) * input.pageSize,
					take: input.pageSize,
					orderBy: { timestamp: 'desc' },
					include: { user: true }
				})
			]);

			return { entries, total, page: input.page, pageSize: input.pageSize };
		})
});
