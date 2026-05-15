import { z } from 'zod';
import { BlacklistType } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';

const entryInput = z.object({
	type: z.nativeEnum(BlacklistType),
	value: z.string().min(1)
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
			return ctx.prisma.blacklist.createMany({ data: input, skipDuplicates: true });
		}),

	remove: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.blacklist.delete({ where: { id: input.id } });
		})
});
