import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { DecisionStatus, Role } from '$lib/generated/prisma/client';
import type { AdminStats } from '$lib/stats';

/**
 * Per-admin activity stats for the dashboard.
 *
 * Two kinds of number, from two different places on purpose.
 *
 * Decisions are state. "How many applicants sit at ACCEPTED because of Ali" is a
 * question about the present, answered by grouping `User.decidedBy`, the column
 * written by the same UPDATE as the decision. Reattributing moves them between
 * buckets, so there is no decrement to compute.
 *
 * Emails and scans are events. They accumulate and are never undone, so they are
 * counted from the audit trail, which already carries `@@index([action, timestamp])`.
 *
 * Both are plain aggregates over a few thousand rows, well under the round trip to the
 * database. A denormalised counter table would save ~1ms while adding a decrement that
 * cannot be computed without consulting the log anyway.
 */

/** Nothing outside these can be a decision bucket the chart draws. */
const RANKED_DECISIONS = [
	DecisionStatus.ACCEPTED,
	DecisionStatus.REJECTED,
	DecisionStatus.WAITLISTED
] as const;

type RankedDecision = (typeof RANKED_DECISIONS)[number];

/**
 * `metadata` is untyped JSON by design (see `$lib/server/log`), and rows written
 * by older versions may be missing keys entirely. Anything that isn't a finite
 * number reads as 0 rather than poisoning the sum with NaN.
 */
function metaNumber(metadata: unknown, key: string): number {
	if (typeof metadata !== 'object' || metadata === null) return 0;
	const value = (metadata as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export const statsRouter = router({
	/**
	 * `adminProcedure`, not `portalProcedure`, despite being an aggregate.
	 *
	 * The dashboard's other aggregates are organizer-visible because they name nobody.
	 * This one names staff and ranks them against each other, which is per-person data
	 * about colleagues. The dashboard skips the call for organizers.
	 *
	 * @param from - inclusive lower bound; omitted means all time
	 * @param to - inclusive upper bound; omitted means up to now
	 */
	byAdmin: adminProcedure
		.input(
			z
				.object({
					from: z.date().optional(),
					to: z.date().optional()
				})
				.default({})
		)
		.query(async ({ ctx, input }) => {
			const { from, to } = input;
			const range = from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;

			const [decisionRows, emailRows, scanRows] = await Promise.all([
				// Not filtered on `decidedBy: { not: null }`. The null bucket is real (history from
				// before attribution existed, and the blacklist auto-reject) and is reported
				// separately rather than silently dropped. `_all`, not a per-field count, because a
				// per-field count ignores nulls and every group here has one.
				ctx.prisma.user.groupBy({
					by: ['decidedBy', 'pendingDecision', 'activeDecision'],
					where: range ? { decidedAt: range } : undefined,
					_count: { _all: true }
				}),

				// Campaign count and audience size come off the same rows, but the audience lives in
				// `metadata` where `groupBy` cannot reach it. Bounded by the number of sends an admin
				// has ever made, so folding in JS is fine.
				ctx.prisma.log.findMany({
					where: {
						action: 'email.custom.send',
						actorId: { not: null },
						...(range && { timestamp: range })
					},
					select: { actorId: true, metadata: true }
				}),

				// From `Log`, not `Scan`: `Scan.userId` is the person scanned, not the
				// organizer holding the phone. Only `Log.actorId` identifies the operator.
				ctx.prisma.log.groupBy({
					by: ['actorId'],
					where: {
						action: 'scan.record',
						actorId: { not: null },
						...(range && { timestamp: range })
					},
					_count: { _all: true }
				})
			]);

			// Fold decisions to the one that currently stands. Counting pending and active both
			// would double-count the instant between the two.
			const decisions = new Map<string, Record<RankedDecision, number>>();
			const unattributed: Record<RankedDecision, number> = {
				ACCEPTED: 0,
				REJECTED: 0,
				WAITLISTED: 0
			};

			for (const row of decisionRows) {
				const effective = row.pendingDecision ?? row.activeDecision;
				// Undecided applicants, and the PENDING placeholder, are not decisions
				// anyone reviewed toward — they belong to no admin's tally.
				if (!effective || !RANKED_DECISIONS.includes(effective as RankedDecision)) continue;
				const bucket = effective as RankedDecision;

				if (row.decidedBy === null) {
					unattributed[bucket] += row._count._all;
					continue;
				}
				let tally = decisions.get(row.decidedBy);
				if (!tally) {
					tally = { ACCEPTED: 0, REJECTED: 0, WAITLISTED: 0 };
					decisions.set(row.decidedBy, tally);
				}
				tally[bucket] += row._count._all;
			}

			const emails = new Map<string, { campaigns: number; recipients: number }>();
			for (const row of emailRows) {
				if (!row.actorId) continue;
				const tally = emails.get(row.actorId) ?? { campaigns: 0, recipients: 0 };
				tally.campaigns += 1;
				// Attempted minus bounced: a bar reading "1,204 sent" when 200 were
				// rejected would be a claim the log itself contradicts.
				tally.recipients +=
					metaNumber(row.metadata, 'recipients') - metaNumber(row.metadata, 'failed');
				emails.set(row.actorId, tally);
			}

			const scans = new Map<string, number>();
			for (const row of scanRows) {
				if (row.actorId) scans.set(row.actorId, row._count._all);
			}

			// Resolve names in one query: the current staff roster, so an admin with no activity
			// still appears at zero, plus anyone with activity who is no longer staff, so a
			// demoted organizer's past work does not vanish.
			const seen = new Set([...decisions.keys(), ...emails.keys(), ...scans.keys()]);
			const people = await ctx.prisma.user.findMany({
				where: {
					OR: [{ role: { in: [Role.ADMIN, Role.ORGANIZER] } }, { uid: { in: [...seen] } }]
				},
				select: { uid: true, name: true, role: true }
			});

			const rows: AdminStats[] = people.map((person) => {
				const decision = decisions.get(person.uid);
				const email = emails.get(person.uid);
				const accepted = decision?.ACCEPTED ?? 0;
				const rejected = decision?.REJECTED ?? 0;
				const waitlisted = decision?.WAITLISTED ?? 0;
				return {
					uid: person.uid,
					name: person.name,
					role: person.role,
					accepted,
					rejected,
					waitlisted,
					decisions: accepted + rejected + waitlisted,
					emailCampaigns: email?.campaigns ?? 0,
					emailRecipients: email?.recipients ?? 0,
					scans: scans.get(person.uid) ?? 0
				};
			});

			// Ranked by review volume, then alphabetically so the zero-activity tail has
			// a stable order instead of shuffling between loads.
			rows.sort((a, b) => b.decisions - a.decisions || a.name.localeCompare(b.name));

			return {
				admins: rows,
				unattributed: {
					accepted: unattributed.ACCEPTED,
					rejected: unattributed.REJECTED,
					waitlisted: unattributed.WAITLISTED,
					total: unattributed.ACCEPTED + unattributed.REJECTED + unattributed.WAITLISTED
				}
			};
		})
});
