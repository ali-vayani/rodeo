import { z } from 'zod';
import type { Prisma } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';

/**
 * Read side of the audit trail; entries are written by `logAction`. No query joins
 * `actor`: every rendered field is snapshotted on the row so history survives an
 * organizer being deleted.
 */

const listInput = z.object({
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(200).default(50),
	/** Filter to one admin. Matches the FK, so a rename doesn't split their history. */
	actorId: z.string().optional(),
	/** Filter to one action slug — see `$lib/log/actions`. */
	action: z.string().optional(),
	/** Free text over the summary, the actor's name/email, and the target label. */
	search: z.string().trim().optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional()
});

export const logRouter = router({
	list: adminProcedure.input(listInput).query(async ({ ctx, input }) => {
		const where: Prisma.LogWhereInput = {};

		if (input.actorId) where.actorId = input.actorId;
		if (input.action) where.action = input.action;

		if (input.from || input.to) {
			where.timestamp = {
				...(input.from && { gte: input.from }),
				...(input.to && { lte: input.to })
			};
		}

		if (input.search) {
			const contains = { contains: input.search, mode: 'insensitive' as const };
			where.OR = [
				{ summary: contains },
				{ actorName: contains },
				{ actorEmail: contains },
				{ targetLabel: contains }
			];
		}

		const [total, entries] = await Promise.all([
			ctx.prisma.log.count({ where }),
			ctx.prisma.log.findMany({
				where,
				skip: (input.page - 1) * input.pageSize,
				take: input.pageSize,
				orderBy: { timestamp: 'desc' }
			})
		]);

		return { entries, total, page: input.page, pageSize: input.pageSize };
	}),

	/**
	 * Distinct admins in the trail, for the actor filter. Grouped over the log rather
	 * than listing all admins: one who has never acted is noise, and one since removed
	 * still needs to be selectable.
	 */
	actors: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.prisma.log.groupBy({
			by: ['actorId', 'actorName'],
			where: { actorId: { not: null } },
			_count: { _all: true }
		});

		return rows
			.map((row) => ({
				actorId: row.actorId as string,
				name: row.actorName ?? 'Unknown admin',
				count: row._count._all
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	})
});
