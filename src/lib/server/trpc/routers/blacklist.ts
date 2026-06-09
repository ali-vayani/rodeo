import { z } from 'zod';
import { router, adminProcedure } from '../init';

const entryInput = z.object({
	name: z.string().min(1),
	email: z.string().email({ error: 'Please enter a valid email address' }),
	reason: z.string().optional()
});

export const blacklistRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.blacklist.findMany({ orderBy: { createdAt: 'desc' } });
	}),

	add: adminProcedure.input(entryInput).mutation(async ({ ctx, input }) => {
		return ctx.prisma.blacklist.create({ data: input });
	}),

	addBulk: adminProcedure
		.input(z.array(entryInput))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.blacklist.createMany({ data: input });
		}),

	remove: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.blacklist.delete({ where: { id: input.id } });
		})
});
