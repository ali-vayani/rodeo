import { z } from 'zod';
import { ScheduleType } from '$lib/generated/prisma/client';
import { router, publicProcedure, adminProcedure } from '../init';

const scheduleInput = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	start: z.coerce.date(),
	end: z.coerce.date(),
	location: z.string().min(1),
	type: z.nativeEnum(ScheduleType)
});

export const scheduleRouter = router({
	list: publicProcedure.query(async ({ ctx }) => {
		return ctx.prisma.schedule.findMany({ orderBy: { start: 'asc' } });
	}),

	create: adminProcedure.input(scheduleInput).mutation(async ({ ctx, input }) => {
		return ctx.prisma.schedule.create({ data: input });
	}),

	update: adminProcedure
		.input(z.object({ id: z.string() }).merge(scheduleInput))
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			return ctx.prisma.schedule.update({ where: { id }, data });
		}),

	delete: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return ctx.prisma.schedule.delete({ where: { id: input.id } });
		})
});
