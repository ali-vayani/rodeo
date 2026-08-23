import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { DecisionStatus, Role } from '$lib/generated/prisma/client';
import type { AdminStats } from '$lib/stats';

/**
 * Per-admin activity stats for the dashboard.
 *
 * Decisions are state, grouped from `User.decidedBy`: reattributing moves a row between
 * buckets, so there is no decrement to compute. Emails and scans are events that are
 * never undone, so they come from the audit trail (indexed on `[action, timestamp]`).
 * Both are aggregates over a few thousand rows; a counter table would save ~1ms.
 */

/** The only decision buckets the chart draws. */
const RANKED_DECISIONS = [
	DecisionStatus.ACCEPTED,
	DecisionStatus.REJECTED,
	DecisionStatus.WAITLISTED
] as const;

type RankedDecision = (typeof RANKED_DECISIONS)[number];

/**
 * `metadata` is untyped JSON and older rows may lack keys. Anything not a finite
 * number reads as 0 rather than poisoning the sum with NaN.
 */
function metaNumber(metadata: unknown, key: string): number {
	if (typeof metadata !== 'object' || metadata === null) return 0;
	const value = (metadata as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export const statsRouter = router({
	/**
	 * `adminProcedure` despite being an aggregate: it names and ranks staff, which is
	 * per-person data about colleagues. The dashboard skips the call for organizers.
	 *
	 * Inputs:
	 * - from: Date — inclusive lower bound; omitted means all time
	 * - to: Date — inclusive upper bound; omitted means up to now
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
				// Null `decidedBy` is real (pre-attribution history, blacklist auto-rejects) and
				// is reported as unattributed. `_all` because a per-field count ignores nulls.
				ctx.prisma.user.groupBy({
					by: ['decidedBy', 'pendingDecision', 'activeDecision'],
					where: range ? { decidedAt: range } : undefined,
					_count: { _all: true }
				}),

				// Audience size lives in `metadata`, out of `groupBy`'s reach; folded in JS.
				ctx.prisma.log.findMany({
					where: {
						action: 'email.custom.send',
						actorId: { not: null },
						...(range && { timestamp: range })
					},
					select: { actorId: true, metadata: true }
				}),

				// From `Log`, not `Scan`: `Scan.userId` is the person scanned, not the operator.
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

			// Pending takes precedence over active; counting both would double-count.
			const decisions = new Map<string, Record<RankedDecision, number>>();
			const unattributed: Record<RankedDecision, number> = {
				ACCEPTED: 0,
				REJECTED: 0,
				WAITLISTED: 0
			};

			for (const row of decisionRows) {
				const effective = row.pendingDecision ?? row.activeDecision;
				// Undecided and the PENDING placeholder belong to no admin's tally.
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
				// Attempted minus bounced, so the bar never claims more than the log does.
				tally.recipients +=
					metaNumber(row.metadata, 'recipients') - metaNumber(row.metadata, 'failed');
				emails.set(row.actorId, tally);
			}

			const scans = new Map<string, number>();
			for (const row of scanRows) {
				if (row.actorId) scans.set(row.actorId, row._count._all);
			}

			// Current staff (so idle admins appear at zero) plus anyone with activity who is
			// no longer staff (so a demoted organizer's past work doesn't vanish).
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

			// Alphabetical tiebreak keeps the zero-activity tail stable between loads.
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
