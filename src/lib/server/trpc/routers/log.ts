import { z } from 'zod';
import type { Prisma } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';

/**
 * Reading the audit trail.
 *
 * Nothing here writes — entries come from `logAction` at the call site of the
 * action being recorded. This router is the `/admin/logs` page's data source and
 * the dashboard's activity feed.
 *
 * Note that no query joins `actor`. Every field the UI renders is snapshotted on
 * the row itself, which is what lets history survive an organizer being deleted;
 * joining would reintroduce exactly the dependency the snapshot exists to avoid.
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
	 * The distinct admins who appear in the trail, for the page's actor filter.
	 *
	 * Grouped over the log itself rather than listing all admins: an organizer who
	 * has never done anything is noise in a filter, and one who has since been
	 * removed still needs to be selectable.
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
