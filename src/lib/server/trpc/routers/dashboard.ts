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

/** Only used for day bucketing, where a wrong offset is cosmetic. */
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
	 * Organizers get the aggregates but not `recentActivity`, which names users. It is
	 * null for them rather than dropped, so the shape is the same for every caller.
	 */
	stats: portalProcedure.query(async ({ ctx }) => {
		const showActivity = isAdmin(ctx.user.role);
		const [total, byStatus, byDecision, byRole, applicantRows, recentActivity] = await Promise.all([
			ctx.prisma.user.count(),

			ctx.prisma.user.groupBy({
				by: ['status'],
				_count: { status: true }
			}),

			// `_all`: a per-field count ignores nulls, so "no decision yet" would read 0.
			ctx.prisma.user.groupBy({
				by: ['activeDecision'],
				_count: { _all: true }
			}),

			ctx.prisma.user.groupBy({
				by: ['role'],
				_count: { role: true }
			}),

			// Decision x role for the stat cards, so each card's number and its hover
			// breakdown come off the same rows. `byDecision` above counts every user, which
			// puts staff into its null bucket. CREATED is excluded to agree with the funnel.
			ctx.prisma.user.groupBy({
				by: ['activeDecision', 'role'],
				where: { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } },
				_count: { _all: true }
			}),

			// No actor join: the feed renders the snapshotted `actorName`.
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

		// `awaiting` collects both null and the PENDING placeholder, which is not an outcome.
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

	/** Names applicants, so admin only. The dashboard skips this call for organizers. */
	recentApplicants: adminProcedure
		.input(z.object({ amount: z.number().int().min(1).max(100).default(10) }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.user.findMany({
				take: input.amount,
				orderBy: { createdAt: 'desc' },
				where: { status: { not: UserStatus.CREATED } },
				// Just what a name card renders; a full row ships `score`, `notes` and
				// `pendingDecision`. See ../selects.
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
	 * The admissions pipeline: applied, decided, accepted, confirmed, checked in.
	 * Not windowed: every stage is present state, and `UserStatus` records where someone
	 * is, never when they got there. One `groupBy` answers all five stages.
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
			// Nothing submitted yet; counting them makes every conversion look worse.
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
	 * Applications and decisions per day. Bucketed in the hackathon's timezone, not UTC,
	 * or a Texas evening's submissions land on tomorrow's bar. Folded in JS rather than
	 * `$queryRaw` + `date_trunc`: a few hundred KB at worst, no raw-SQL timezone
	 * handling, and the mocked-Prisma tests can exercise it.
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

			// Idle days still get a point, so a flat stretch isn't a line between two peaks.
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
	 * Staff and applicant actions in one feed. `Log` only records staff work, so
	 * applicant rows are derived from `User.createdAt` and `Scan`. Classification is by
	 * action slug, never the actor's current role, so a demoted organizer's past
	 * decisions don't reclassify.
	 *
	 * Known gap: RSVP confirm/decline can't appear because `UserStatus` has no timestamp
	 * to sort by. Fixing it needs a `statusChangedAt` column.
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

			// Each source fetches `limit` rows since one source may supply all of them.
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
				// The schema has no submission timestamp; createdAt stands in.
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

			// Ties broken by id so same-millisecond rows don't shuffle between fetches.
			entries.sort(
				(a, b) => b.timestamp.getTime() - a.timestamp.getTime() || a.id.localeCompare(b.id)
			);
			return entries.slice(0, limit);
		}),

	/**
	 * University and year breakdowns. `adminProcedure` as with `filters.facets`: exact
	 * headcounts per university are per-person data in aggregate clothing. Reads the
	 * linked columns directly because `facets` ships up to 500 options per facet and a
	 * card wants the top handful plus the size of the tail.
	 */
	demographics: adminProcedure
		.input(z.object({ top: z.number().int().min(3).max(20).default(7) }).default({ top: 7 }))
		.query(async ({ ctx, input }): Promise<Demographics> => {
			const where = { role: { in: APPLICANT_ROLES }, status: { not: UserStatus.CREATED } };

			const [universityRows, yearRows, questions] = await Promise.all([
				ctx.prisma.user.groupBy({ by: ['university'], where, _count: { _all: true } }),
				ctx.prisma.user.groupBy({ by: ['year'], where, _count: { _all: true } }),
				// Card labels follow the form's own wording ("Year" vs "Class standing").
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

			// Declared order beats popularity for an ordinal field (Freshman to Senior).
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
