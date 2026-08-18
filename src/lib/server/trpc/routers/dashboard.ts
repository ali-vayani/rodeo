import { z } from 'zod';
import { router, adminProcedure, portalProcedure } from '../init';
import { isAdmin } from '$lib/auth/permissions';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { UserStatus, Role, DecisionStatus } from '$lib/generated/prisma/client';
import { dayKey, nextDayKey } from '$lib/schedule/days';
import { NOTABLE_ACTIONS } from '$lib/log/notable';
import { FILTERABLE_LINKED_FIELDS, isLinkedField, type LinkedField } from '$lib/linkedFields';
import type {
	ActivityEntry,
	Demographics,
	FunnelStage,
	TrendSeries,
	ValueCount
} from '$lib/dashboard';

/** A count with the role split behind it, for the stat cards' hover breakdown. */
export interface RoleTally {
	total: number;
	byRole: Partial<Record<Role, number>>;
}

function emptyTally(): RoleTally {
	return { total: 0, byRole: {} };
}

/** Decisions that mean a reviewer reached a verdict. PENDING is a starting state. */
const SETTLED_DECISIONS = [
	DecisionStatus.ACCEPTED,
	DecisionStatus.REJECTED,
	DecisionStatus.WAITLISTED
] as const;

/**
 * Fallback when `Settings` has no row yet (a fresh database, or the tests).
 * Only ever used for day bucketing, where being wrong by an offset is cosmetic.
 */
const FALLBACK_TIMEZONE = 'America/Chicago';

/** Windows the dashboard offers. `null` means all time. */
const WINDOW_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, all: null };

const windowInput = z.enum(['7d', '30d', 'all']).default('all');

/** Inclusive lower bound for a window, or undefined for all time. */
function windowStart(window: string): Date | undefined {
	const days = WINDOW_DAYS[window] ?? null;
	if (days === null) return undefined;
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function eventTimezone(prisma: { settings: { findFirst: () => Promise<unknown> } }) {
	const settings = (await prisma.settings.findFirst()) as { timezone?: string } | null;
	return settings?.timezone || FALLBACK_TIMEZONE;
}

export const dashboardRouter = router({
	/**
	 * Organizers get the aggregates — counts and charts name nobody — but not
	 * `recentActivity`, which is a log of named users. It comes back null for them
	 * rather than being dropped, so the shape stays the same for every caller and the
	 * dashboard can just check for it.
	 */
	stats: portalProcedure.query(async ({ ctx }) => {
		const showActivity = isAdmin(ctx.user.role);
		const [total, byStatus, byDecision, byRole, applicantRows, recentActivity] = await Promise.all([
			ctx.prisma.user.count(),

			ctx.prisma.user.groupBy({
				by: ['status'],
				_count: { status: true }
			}),

			// `_all`, not `_count: { activeDecision: true }`: a per-field count ignores nulls,
			// so the "no decision yet" bucket would always read 0 no matter how many are
			// undecided.
			ctx.prisma.user.groupBy({
				by: ['activeDecision'],
				_count: { _all: true }
			}),

			// A real `groupBy` now that a user holds one role. This used to select every
			// user's role array and tally it in memory, because a user counted once per
			// role they held and no SQL aggregate expresses that. One role each makes the
			// count a plain GROUP BY, so the whole table stops crossing the wire on every
			// dashboard load.
			ctx.prisma.user.groupBy({
				by: ['role'],
				_count: { role: true }
			}),

			// Decision × role, bounded to the people who actually go through admissions.
			// The `byDecision` tally above counts every user, which puts 60-odd staff
			// accounts — who never apply and never hold a decision — into its null
			// bucket. The stat cards read from this instead, so "Accepted" and
			// "Awaiting" describe applicants rather than the whole table, and the role
			// split each card shows on hover comes off the same rows as its number.
			//
			// CREATED is excluded for the same reason the funnel excludes it, and the
			// two must agree or the page contradicts itself: an account that has not
			// submitted anything is not "awaiting a decision", it is not in the queue at
			// all. Counting them inflated `awaiting` by every half-registered account and
			// made the header's applicant count differ from this card's.
			ctx.prisma.user.groupBy({
				by: ['activeDecision', 'role'],
				where: { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } },
				_count: { _all: true }
			}),

			// No `include: { actor: true }`: the feed renders `actorName`, which is
			// snapshotted on the row precisely so it doesn't need the join.
			showActivity
				? ctx.prisma.log.findMany({
						take: 20,
						orderBy: { timestamp: 'desc' }
					})
				: null
		]);

		const roleCounts: Partial<Record<Role, number>> = {};
		for (const row of byRole) {
			roleCounts[row.role] = row._count.role;
		}

		const statusCounts: Partial<Record<UserStatus, number>> = {};
		for (const row of byStatus) {
			statusCounts[row.status] = row._count.status;
		}

		const decisionCounts: Partial<Record<string, number>> = {};
		for (const row of byDecision) {
			const key = row.activeDecision ?? 'null';
			decisionCounts[key] = row._count._all;
		}

		// One pass over the decision × role rows fills every stat card and its hover
		// breakdown. `awaiting` collects both a null activeDecision and the PENDING
		// placeholder: PENDING is a starting state rather than an outcome, so a user
		// carrying it has not been decided either way.
		const applicants = {
			total: 0,
			accepted: emptyTally(),
			rejected: emptyTally(),
			waitlisted: emptyTally(),
			awaiting: emptyTally(),
			byRole: {} as Partial<Record<Role, number>>
		};

		const TALLY_FOR: Record<string, keyof typeof applicants> = {
			[DecisionStatus.ACCEPTED]: 'accepted',
			[DecisionStatus.REJECTED]: 'rejected',
			[DecisionStatus.WAITLISTED]: 'waitlisted'
		};

		for (const row of applicantRows) {
			const count = row._count._all;
			const key = row.activeDecision ? (TALLY_FOR[row.activeDecision] ?? 'awaiting') : 'awaiting';
			const tally = applicants[key] as RoleTally;

			tally.total += count;
			tally.byRole[row.role] = (tally.byRole[row.role] ?? 0) + count;
			applicants.total += count;
			applicants.byRole[row.role] = (applicants.byRole[row.role] ?? 0) + count;
		}

		return {
			total,
			byStatus: statusCounts,
			byDecision: decisionCounts,
			byRole: roleCounts,
			applicants,
			recentActivity
		};
	}),

	/** Named applicants — admin only. The dashboard skips this call for organizers. */
	recentApplicants: adminProcedure
		.input(z.object({ amount: z.number().int().min(1).max(100).default(10) }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.user.findMany({
				take: input.amount,
				orderBy: { createdAt: 'desc' },
				where: { status: { not: UserStatus.CREATED } },
				// Just what a name card renders. An unprojected row would ship `score`,
				// `notes`, `pendingDecision` and the claim columns to the dashboard to
				// draw a name — see $lib/server/trpc/selects for the embargo this respects.
				select: {
					uid: true,
					name: true,
					email: true,
					role: true,
					status: true,
					createdAt: true
				}
			});
		}),

	/**
	 * The admissions pipeline: applied → decided → accepted → confirmed → checked in.
	 *
	 * Deliberately NOT windowed, and the dashboard labels it "current". Every stage is
	 * a question about present state ("how many are confirmed right now"), and three of
	 * the five have no timestamp to filter on anyway — `UserStatus` records where
	 * someone *is*, never when they got there. Offering a range control over it would
	 * be a filter that silently does nothing to most of the chart.
	 *
	 * One `groupBy` over (status × activeDecision) answers all five: they are five
	 * different reads of the same rows, not five populations.
	 */
	funnel: portalProcedure.query(async ({ ctx }): Promise<FunnelStage[]> => {
		const rows = await ctx.prisma.user.groupBy({
			by: ['status', 'activeDecision'],
			where: { role: { in: APPLICANT_ROLES } },
			_count: { _all: true }
		});

		let applied = 0;
		let decided = 0;
		let accepted = 0;
		let confirmed = 0;
		let checkedIn = 0;

		for (const row of rows) {
			const count = row._count._all;
			// CREATED means the account exists but nothing was submitted — not an
			// applicant yet, and counting them would make every conversion below look
			// worse than it is.
			if (row.status === UserStatus.CREATED) continue;
			applied += count;

			if (row.activeDecision && SETTLED_DECISIONS.includes(row.activeDecision as never)) {
				decided += count;
				if (row.activeDecision === DecisionStatus.ACCEPTED) accepted += count;
			}
			// CHECKED_IN implies confirmed: someone at the door RSVP'd to get there.
			if (row.status === UserStatus.CONFIRMED || row.status === UserStatus.CHECKED_IN) {
				confirmed += count;
			}
			if (row.status === UserStatus.CHECKED_IN) checkedIn += count;
		}

		/** Share of the previous stage, or null when that stage is empty. */
		const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

		return [
			{
				key: 'applied',
				label: 'Applied',
				hint: 'submitted an application',
				count: applied,
				conversion: null,
				conversionOf: null
			},
			{
				key: 'decided',
				label: 'Decided',
				hint: 'reviewed and released',
				count: decided,
				conversion: ratio(decided, applied),
				conversionOf: 'of applied'
			},
			{
				key: 'accepted',
				label: 'Accepted',
				hint: 'offered a spot',
				count: accepted,
				conversion: ratio(accepted, decided),
				conversionOf: 'of decided'
			},
			{
				key: 'confirmed',
				label: 'Confirmed',
				hint: 'RSVP’d yes',
				count: confirmed,
				conversion: ratio(confirmed, accepted),
				conversionOf: 'of accepted'
			},
			{
				key: 'checkedIn',
				label: 'Checked in',
				hint: 'scanned at the door',
				count: checkedIn,
				conversion: ratio(checkedIn, confirmed),
				conversionOf: 'of confirmed'
			}
		];
	}),

	/**
	 * Applications and decisions per day, as two series on one scale.
	 *
	 * Bucketed in the hackathon's timezone, not UTC — a Texas hackathon's 7pm
	 * submissions are tomorrow's in UTC, which would shift a whole evening's traffic
	 * onto the wrong bar every day.
	 *
	 * Selects the two date columns and folds in JS rather than reaching for
	 * `$queryRaw` with `date_trunc`. Both sets are bounded by the applicant pool —
	 * low thousands, two columns wide — so this is a few hundred KB at the very
	 * worst, against a raw query that would need its own timezone handling and could
	 * not be exercised by the mocked-Prisma tests the rest of this router uses.
	 */
	overTime: portalProcedure
		.input(z.object({ window: windowInput }).default({ window: 'all' }))
		.query(async ({ ctx, input }): Promise<TrendSeries> => {
			const from = windowStart(input.window);
			const timezone = await eventTimezone(ctx.prisma);

			const [applications, decisions, earliest] = await Promise.all([
				ctx.prisma.user.findMany({
					where: {
						role: { in: APPLICANT_ROLES },
						status: { not: UserStatus.CREATED },
						...(from && { createdAt: { gte: from } })
					},
					select: { createdAt: true }
				}),
				ctx.prisma.user.findMany({
					where: {
						role: { in: APPLICANT_ROLES },
						decidedAt: { not: null, ...(from && { gte: from }) }
					},
					select: { decidedAt: true }
				}),
				// Only needed to decide where an "all time" axis starts.
				from
					? null
					: ctx.prisma.user.findFirst({
							where: { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } },
							orderBy: { createdAt: 'asc' },
							select: { createdAt: true }
						})
			]);

			const buckets = new Map<string, { applications: number; decisions: number }>();
			const bump = (date: Date, key: 'applications' | 'decisions') => {
				const day = dayKey(date, timezone);
				const bucket = buckets.get(day) ?? { applications: 0, decisions: 0 };
				bucket[key] += 1;
				buckets.set(day, bucket);
			};

			for (const row of applications) bump(row.createdAt, 'applications');
			for (const row of decisions) if (row.decidedAt) bump(row.decidedAt, 'decisions');

			// Days with no activity still get a point, so a flat stretch reads as "nothing
			// happened" rather than being closed over by a straight line between two peaks.
			const today = dayKey(new Date(), timezone);
			const firstSeen = [...buckets.keys()].sort()[0];
			const start = from
				? dayKey(from, timezone)
				: (earliest ? dayKey(earliest.createdAt, timezone) : firstSeen) || today;

			const points: TrendSeries['points'] = [];
			// Bounded so a database with one very old row can't spin here.
			for (let day = start; day <= today && points.length < 400; day = nextDayKey(day)) {
				const bucket = buckets.get(day) ?? { applications: 0, decisions: 0 };
				points.push({ day, ...bucket });
			}

			return {
				points,
				timezone,
				truncated: Boolean(from && firstSeen !== undefined && firstSeen < start)
			};
		}),

	/**
	 * The unified activity feed: staff actions and applicant actions in one stream.
	 *
	 * Two sources, because `Log` only ever records staff work — every slug in
	 * `LOG_ACTIONS` is something an admin or organizer did. Applicant rows are
	 * therefore *derived*: an application from `User.createdAt`, a check-in from
	 * `Scan`. That is also what makes the source filter meaningful rather than
	 * cosmetic.
	 *
	 * Classification is by action slug, never by the actor's current role. An
	 * organizer who is later demoted to hacker must not have their past decisions
	 * reclassify — the slug records what was done, and that does not change.
	 *
	 * Known gap: RSVP confirm/decline cannot appear here. `UserStatus` has no
	 * timestamp, so there is no instant to sort those rows by. Adding one is a schema
	 * change (`statusChangedAt`), not something this query can work around, and
	 * inventing an order for them would be worse than their absence.
	 */
	activity: adminProcedure
		.input(
			z
				.object({
					source: z.enum(['all', 'admin', 'hacker']).default('all'),
					window: windowInput,
					limit: z.number().int().min(1).max(100).default(12)
				})
				.default({ source: 'all', window: 'all', limit: 12 })
		)
		.query(async ({ ctx, input }): Promise<ActivityEntry[]> => {
			const { source, limit } = input;
			const from = windowStart(input.window);
			const wantAdmin = source === 'all' || source === 'admin';
			const wantHacker = source === 'all' || source === 'hacker';

			// Each source fetches `limit` rows: after the merge the newest `limit` win, and
			// one source can legitimately supply all of them.
			const [logs, applicants, scans] = await Promise.all([
				wantAdmin
					? ctx.prisma.log.findMany({
							where: from ? { timestamp: { gte: from } } : undefined,
							take: limit,
							orderBy: { timestamp: 'desc' }
						})
					: [],
				wantHacker
					? ctx.prisma.user.findMany({
							where: {
								role: { in: APPLICANT_ROLES },
								status: { not: UserStatus.CREATED },
								...(from && { createdAt: { gte: from } })
							},
							take: limit,
							orderBy: { createdAt: 'desc' },
							select: { uid: true, name: true, university: true, year: true, createdAt: true }
						})
					: [],
				wantHacker
					? ctx.prisma.scan.findMany({
							where: from ? { timestamp: { gte: from } } : undefined,
							take: limit,
							orderBy: { timestamp: 'desc' },
							select: {
								id: true,
								action: true,
								timestamp: true,
								user: { select: { name: true } }
							}
						})
					: []
			]);

			const entries: ActivityEntry[] = [];

			for (const log of logs) {
				const to = (log.metadata as { to?: unknown } | null)?.to;
				entries.push({
					id: `log:${log.id}`,
					source: 'admin',
					action: log.action,
					actorName: log.actorName,
					summary: log.summary,
					timestamp: log.timestamp,
					detail: log.targetLabel,
					tone:
						to === DecisionStatus.ACCEPTED
							? 'accepted'
							: to === DecisionStatus.REJECTED
								? 'rejected'
								: to === DecisionStatus.WAITLISTED
									? 'waitlisted'
									: 'neutral',
					notable: NOTABLE_ACTIONS.has(log.action)
				});
			}

			for (const applicant of applicants) {
				// createdAt, not a submission timestamp — the schema has no separate one, and
				// an applicant-role account that is past CREATED has submitted. The two differ
				// only for someone who registered and applied on different days.
				const detail = [applicant.university, applicant.year].filter(Boolean).join(' · ');
				entries.push({
					id: `applicant:${applicant.uid}`,
					source: 'hacker',
					action: 'applicant.submit',
					actorName: applicant.name,
					summary: 'submitted an application',
					timestamp: applicant.createdAt,
					detail: detail || null,
					tone: 'neutral',
					notable: false
				});
			}

			for (const scan of scans) {
				entries.push({
					id: `scan:${scan.id}`,
					source: 'hacker',
					action: 'applicant.scan',
					actorName: scan.user?.name ?? null,
					summary: `was scanned for ${scan.action}`,
					timestamp: scan.timestamp,
					detail: scan.action,
					tone: 'neutral',
					notable: false
				});
			}

			// Ties broken by id so a re-fetch can't shuffle two rows written in the same
			// millisecond past each other.
			entries.sort(
				(a, b) => b.timestamp.getTime() - a.timestamp.getTime() || a.id.localeCompare(b.id)
			);
			return entries.slice(0, limit);
		}),

	/**
	 * Where applicants come from and how far along they are.
	 *
	 * `adminProcedure` for the same reason as `filters.linkedFacets`: a list of every
	 * university with exact headcounts is per-person data in aggregate clothing — at a
	 * count of one it is literally per-person.
	 *
	 * Reads the two linked columns directly rather than going through
	 * `filters.linkedFacets`, which ships up to 500 options per facet because it is
	 * building a filter vocabulary. A dashboard card wants the top handful and the size
	 * of the tail.
	 */
	demographics: adminProcedure
		.input(z.object({ top: z.number().int().min(3).max(20).default(7) }).default({ top: 7 }))
		.query(async ({ ctx, input }): Promise<Demographics> => {
			const where = { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } };

			const [universityRows, yearRows, questions] = await Promise.all([
				ctx.prisma.user.groupBy({ by: ['university'], where, _count: { _all: true } }),
				ctx.prisma.user.groupBy({ by: ['year'], where, _count: { _all: true } }),
				// Labels come from the questions, so each card is headed the way the form
				// actually asks — "Year" here, "Class standing" at another hackathon.
				ctx.prisma.question.findMany({
					where: { linkedField: { in: [...FILTERABLE_LINKED_FIELDS] } },
					select: { title: true, options: true, linkedField: true },
					orderBy: { order: 'asc' }
				})
			]);

			/** Empty string and NULL are the same absence — see `filters.observedValues`. */
			function tally(
				rows: Array<{ _count: { _all: number } } & Record<string, unknown>>,
				key: string
			) {
				const counts: ValueCount[] = [];
				let none = 0;
				for (const row of rows) {
					const value = row[key];
					if (typeof value !== 'string' || value === '') none += row._count._all;
					else counts.push({ label: value, count: row._count._all });
				}
				counts.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
				return { counts, none };
			}

			const uni = tally(universityRows as never, 'university');
			const yr = tally(yearRows as never, 'year');

			const universities = uni.counts.slice(0, input.top);
			const rest = uni.counts.slice(input.top);
			const labelFor = (field: LinkedField) =>
				questions.find((q) => isLinkedField(q.linkedField) && q.linkedField === field);
			const yearQuestion = labelFor('YEAR');

			// A declared option order beats popularity for an ordinal field: Freshman →
			// Senior is the order the reader expects, and re-sorting it by headcount makes
			// the shape of the cohort unreadable.
			const declared = yearQuestion?.options ?? [];
			const years = declared.length
				? [
						...declared.map((label) => ({
							label,
							count: yr.counts.find((c) => c.label === label)?.count ?? 0
						})),
						...yr.counts.filter((c) => !declared.includes(c.label))
					]
				: yr.counts;

			return {
				universities,
				tail: rest.length
					? {
							schools: rest.length,
							applicants: rest.reduce((sum, r) => sum + r.count, 0),
							largest: rest[0].count
						}
					: null,
				distinctUniversities: uni.counts.length,
				years,
				noUniversity: uni.none,
				universityLabel: labelFor('UNIVERSITY')?.title ?? 'University',
				yearLabel: yearQuestion?.title ?? 'Year'
			};
		})
});
