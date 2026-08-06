import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ScheduleType } from '$lib/generated/prisma/client';
import { router, publicProcedure, portalProcedure } from '../init';
import { logAction } from '$lib/server/log';

const scheduleFields = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	start: z.coerce.date(),
	end: z.coerce.date(),
	location: z.string().min(1).max(200),
	type: z.nativeEnum(ScheduleType)
});

// An event that ends before it starts corrupts duration and day-bucketing in the UI.
const endsAfterStart = (v: { start: Date; end: Date }) => v.end >= v.start;
const endsAfterStartError = { message: 'Event end must be at or after its start.', path: ['end'] };

const scheduleInput = scheduleFields.refine(endsAfterStart, endsAfterStartError);
const scheduleUpdateInput = scheduleFields
	.extend({ id: z.string().min(1) })
	.refine(endsAfterStart, endsAfterStartError);

/** Prisma's "no row matched the where clause" code, thrown by update/delete on a bad id. */
function isRecordNotFound(e: unknown): boolean {
	return (
		typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'P2025'
	);
}

export const scheduleRouter = router({
	list: publicProcedure.query(async ({ ctx }) => {
		return ctx.prisma.schedule.findMany({ orderBy: { start: 'asc' } });
	}),

	create: portalProcedure.input(scheduleInput).mutation(async ({ ctx, input }) => {
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

	update: portalProcedure.input(scheduleUpdateInput).mutation(async ({ ctx, input }) => {
		const { id, ...data } = input;
		try {
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
		} catch (e) {
			if (isRecordNotFound(e))
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
			throw e;
		}
	}),

	delete: portalProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			try {
				const event = await ctx.prisma.schedule.delete({ where: { id: input.id } });

				await logAction(ctx, {
					action: 'schedule.delete',
					summary: `Deleted the event "${event.name}"`,
					target: { id: event.id, label: event.name },
					metadata: { type: event.type, start: event.start.toISOString() }
				});

				return event;
			} catch (e) {
				if (isRecordNotFound(e)) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
				}
				throw e;
			}
		})
});
