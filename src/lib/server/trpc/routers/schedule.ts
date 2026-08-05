import { z } from 'zod';
import { ScheduleType } from '$lib/generated/prisma/client';
import { router, publicProcedure, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';

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
		const event = await ctx.prisma.schedule.create({ data: input });

		await logAction(ctx, {
			action: 'schedule.create',
			summary: `Added the event "${event.name}"`,
			target: { id: event.id, label: event.name },
			metadata: {
				type: event.type,
				location: event.location,
				start: event.start.toISOString(),
				end: event.end.toISOString()
			}
		});

		return event;
	}),

	update: adminProcedure
		.input(z.object({ id: z.string() }).merge(scheduleInput))
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			const event = await ctx.prisma.schedule.update({ where: { id }, data });

			await logAction(ctx, {
				action: 'schedule.update',
				summary: `Edited the event "${event.name}"`,
				target: { id: event.id, label: event.name },
				metadata: {
					type: event.type,
					location: event.location,
					start: event.start.toISOString(),
					end: event.end.toISOString()
				}
			});

			return event;
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const event = await ctx.prisma.schedule.delete({ where: { id: input.id } });

		await logAction(ctx, {
			action: 'schedule.delete',
			summary: `Deleted the event "${event.name}"`,
			target: { id: event.id, label: event.name },
			metadata: { type: event.type, start: event.start.toISOString() }
		});

		return event;
	})
});
