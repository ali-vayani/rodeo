import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, organizerUser, mockGroupBy } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => {
	mockReset(db);
	// Every procedure here reads the timezone for day bucketing or label lookup.
	db.settings.findFirst.mockResolvedValue({ timezone: 'America/Chicago' } as never);
});

describe('dashboard.funnel', () => {
	/** One groupBy row: a (status, decision) pair and how many sit at it. */
	const row = (status: UserStatus, activeDecision: DecisionStatus | null, count: number) =>
		({ status, activeDecision, _count: { _all: count } }) as never;

	it('counts each stage as a different read of the same rows', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce([
			// Never submitted — must not count as applied.
			row(UserStatus.CREATED, null, 40),
			row(UserStatus.APPLIED, null, 10),
			row(UserStatus.APPLIED, DecisionStatus.REJECTED, 5),
			row(UserStatus.APPLIED, DecisionStatus.WAITLISTED, 3),
			row(UserStatus.APPLIED, DecisionStatus.ACCEPTED, 4),
			row(UserStatus.CONFIRMED, DecisionStatus.ACCEPTED, 6),
			row(UserStatus.CHECKED_IN, DecisionStatus.ACCEPTED, 2)
		] as never);

		const stages = await caller.dashboard.funnel();
		const count = (key: string) => stages.find((s) => s.key === key)?.count;

		expect(count('created')).toBe(70); // every account, CREATED included
		expect(count('applied')).toBe(30); // 10+5+3+4+6+2, the 40 CREATED excluded
		expect(count('decided')).toBe(20); // 5+3+4+6+2
		expect(count('accepted')).toBe(12); // 4+6+2
		expect(count('confirmed')).toBe(8); // CONFIRMED + CHECKED_IN
		expect(count('checkedIn')).toBe(2);
	});

	it('reports conversions against the previous stage, not against applied', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce([
			row(UserStatus.APPLIED, DecisionStatus.REJECTED, 50),
			row(UserStatus.CONFIRMED, DecisionStatus.ACCEPTED, 50)
		] as never);

		const stages = await caller.dashboard.funnel();
		expect(stages[0].conversion).toBeNull(); // accounts has nothing to convert from
		expect(stages.find((s) => s.key === 'applied')?.conversion).toBe(1); // 100 of 100 accounts
		expect(stages.find((s) => s.key === 'decided')?.conversion).toBe(1); // 100/100
		expect(stages.find((s) => s.key === 'accepted')?.conversion).toBe(0.5); // 50 of 100 decided
		expect(stages.find((s) => s.key === 'confirmed')?.conversion).toBe(1); // 50 of 50 accepted
	});

	it('returns null rather than dividing by zero when a stage is empty', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce([] as never);

		const stages = await caller.dashboard.funnel();
		expect(stages.every((s) => s.count === 0)).toBe(true);
		expect(stages.map((s) => s.conversion)).toEqual([null, null, null, null, null, null]);
	});

	it('is visible to organizers — it names nobody', async () => {
		const caller = createTestCaller(db, organizerUser);
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce([] as never);
		await expect(caller.dashboard.funnel()).resolves.toBeDefined();
	});
});

describe('dashboard.overTime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Noon UTC on the 10th is still the 10th in America/Chicago, so "today" is
		// unambiguous and the assertions don't depend on which side of midnight the
		// suite runs.
		vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('buckets by day and fills the gaps between them', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany
			.mockResolvedValueOnce([
				{ createdAt: new Date('2026-03-08T15:00:00Z') },
				{ createdAt: new Date('2026-03-08T18:00:00Z') },
				{ createdAt: new Date('2026-03-10T09:00:00Z') }
			] as never)
			.mockResolvedValueOnce([{ decidedAt: new Date('2026-03-10T11:00:00Z') }] as never);
		db.user.findFirst.mockResolvedValue({ createdAt: new Date('2026-03-08T15:00:00Z') } as never);

		const result = await caller.dashboard.overTime({ window: 'all' });

		// The 9th had no activity but still gets a point: a straight line drawn across
		// it would claim a slope that never happened.
		expect(result.points.map((p) => p.day)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
		expect(result.points.map((p) => p.applications)).toEqual([2, 0, 1]);
		expect(result.points.map((p) => p.decisions)).toEqual([0, 0, 1]);
	});

	it('buckets in the event timezone, not UTC', async () => {
		const caller = createTestCaller(db, adminUser);
		// 02:00 UTC on the 10th is 20:00 on the 9th in Chicago. Bucketing in UTC would
		// move a whole evening of submissions onto the wrong bar.
		db.user.findMany
			.mockResolvedValueOnce([{ createdAt: new Date('2026-03-10T02:00:00Z') }] as never)
			.mockResolvedValueOnce([] as never);
		db.user.findFirst.mockResolvedValue({ createdAt: new Date('2026-03-10T02:00:00Z') } as never);

		const result = await caller.dashboard.overTime({ window: 'all' });
		expect(result.timezone).toBe('America/Chicago');
		expect(result.points[0].day).toBe('2026-03-09');
		expect(result.points[0].applications).toBe(1);
	});

	it('scopes the query when a window is given', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		await caller.dashboard.overTime({ window: '7d' });

		const [applicationsCall] = db.user.findMany.mock.calls;
		const where = (applicationsCall[0] as { where: { createdAt?: { gte: Date } } }).where;
		expect(where.createdAt?.gte).toEqual(new Date('2026-03-03T12:00:00Z'));
		// No "earliest row" probe is needed when the window already fixes the start.
		expect(db.user.findFirst).not.toHaveBeenCalled();
	});
});

describe('dashboard.activity', () => {
	const log = (id: string, at: string, over: Partial<Record<string, unknown>> = {}) =>
		({
			id,
			action: 'admissions.decision.set',
			summary: 'accepted Sarah Chen',
			timestamp: new Date(at),
			actorId: 'admin-uid',
			actorName: 'Admin User',
			actorEmail: null,
			targetId: null,
			targetLabel: null,
			metadata: null,
			...over
		}) as never;

	it('merges staff and applicant rows into one newest-first stream', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.findMany.mockResolvedValue([log('L1', '2026-03-10T10:00:00Z')] as never);
		db.user.findMany.mockResolvedValue([
			{
				uid: 'u1',
				name: 'Miguel Ortiz',
				university: 'UT Austin',
				year: 'Junior',
				createdAt: new Date('2026-03-10T11:00:00Z')
			}
		] as never);
		db.scan.findMany.mockResolvedValue([
			{
				id: 's1',
				action: 'check-in',
				timestamp: new Date('2026-03-10T09:00:00Z'),
				user: { name: 'Leah Nguyen' }
			}
		] as never);

		const entries = await caller.dashboard.activity({ source: 'all', window: 'all', limit: 12 });

		expect(entries.map((e) => e.id)).toEqual(['applicant:u1', 'log:L1', 'scan:s1']);
		expect(entries.map((e) => e.source)).toEqual(['hacker', 'admin', 'hacker']);
		// Applicant detail is the chip the feed shows beside the row.
		expect(entries[0].detail).toBe('UT Austin · Junior');
	});

	it('does not query the sources a filter excludes', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.findMany.mockResolvedValue([] as never);

		await caller.dashboard.activity({ source: 'admin', window: 'all', limit: 12 });

		expect(db.log.findMany).toHaveBeenCalled();
		expect(db.user.findMany).not.toHaveBeenCalled();
		expect(db.scan.findMany).not.toHaveBeenCalled();
	});

	it('classifies by action slug, never by the actor’s current role', async () => {
		const caller = createTestCaller(db, adminUser);
		// A decision logged by someone who is a HACKER today — a demoted organizer.
		// The row must stay admin activity: the slug records what was done.
		db.log.findMany.mockResolvedValue([
			log('L1', '2026-03-10T10:00:00Z', { actorName: 'Demoted Person' })
		] as never);
		db.user.findMany.mockResolvedValue([] as never);
		db.scan.findMany.mockResolvedValue([] as never);

		const entries = await caller.dashboard.activity({ source: 'admin', window: 'all', limit: 12 });
		expect(entries[0].source).toBe('admin');
	});

	it('reads the decision tone off the log metadata', async () => {
		const caller = createTestCaller(db, adminUser);
		db.log.findMany.mockResolvedValue([
			log('L1', '2026-03-10T10:00:00Z', { metadata: { from: 'PENDING', to: 'WAITLISTED' } }),
			log('L2', '2026-03-10T09:00:00Z', { action: 'settings.update', metadata: null })
		] as never);
		db.user.findMany.mockResolvedValue([] as never);
		db.scan.findMany.mockResolvedValue([] as never);

		const entries = await caller.dashboard.activity({ source: 'admin', window: 'all', limit: 12 });
		expect(entries[0].tone).toBe('waitlisted');
		expect(entries[1].tone).toBe('neutral');
		expect(entries[1].notable).toBe(true); // settings.update is in NOTABLE_ACTIONS
	});

	it('is refused to organizers — it names people', async () => {
		const caller = createTestCaller(db, organizerUser);
		await expect(
			caller.dashboard.activity({ source: 'all', window: 'all', limit: 12 })
		).rejects.toThrow();
	});
});

describe('dashboard.demographics', () => {
	const uni = (university: string | null, count: number) =>
		({ university, _count: { _all: count } }) as never;
	const yr = (year: string | null, count: number) => ({ year, _count: { _all: count } }) as never;

	beforeEach(() => {
		db.question.findMany.mockResolvedValue([
			{ title: 'University', options: [], linkedField: 'UNIVERSITY' },
			{ title: 'Year', options: ['Freshman', 'Sophomore', 'Junior'], linkedField: 'YEAR' }
		] as never);
	});

	it('splits the top schools from the tail rather than drawing the tail as one bar', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([
				uni('UT Austin', 40),
				uni('Texas A&M', 30),
				uni('Rice', 20),
				uni('UTSA', 5),
				uni('Baylor', 4),
				uni(null, 7)
			] as never)
			.mockResolvedValueOnce([] as never);

		const result = await caller.dashboard.demographics({ top: 3 });

		expect(result.universities.map((u) => u.label)).toEqual(['UT Austin', 'Texas A&M', 'Rice']);
		// 9 applicants across 2 schools — reported as a residual, and `largest` proves
		// none of them out-ranks the bars above.
		expect(result.tail).toEqual({ schools: 2, applicants: 9, largest: 5 });
		expect(result.distinctUniversities).toBe(5);
		expect(result.noUniversity).toBe(7);
	});

	it('counts empty string as absent, the same as null', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([uni('', 3), uni(null, 2), uni('Rice', 1)] as never)
			.mockResolvedValueOnce([] as never);

		const result = await caller.dashboard.demographics({ top: 7 });
		expect(result.noUniversity).toBe(5);
		expect(result.universities).toEqual([{ label: 'Rice', count: 1 }]);
	});

	it('keeps Year in the question’s declared order, not in popularity order', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([] as never)
			.mockResolvedValueOnce([yr('Junior', 50), yr('Freshman', 10), yr('Grad', 2)] as never);

		const result = await caller.dashboard.demographics({ top: 7 });

		// Declared order first, zero-filled; values nobody can pick any more trail it.
		expect(result.years).toEqual([
			{ label: 'Freshman', count: 10 },
			{ label: 'Sophomore', count: 0 },
			{ label: 'Junior', count: 50 },
			{ label: 'Grad', count: 2 }
		]);
	});

	it('labels the cards the way the form asks', async () => {
		const caller = createTestCaller(db, adminUser);
		db.question.findMany.mockResolvedValue([
			{ title: 'Where do you study?', options: [], linkedField: 'UNIVERSITY' },
			{ title: 'Class standing', options: [], linkedField: 'YEAR' }
		] as never);
		mockGroupBy(db.user.groupBy)
			.mockResolvedValueOnce([] as never)
			.mockResolvedValueOnce([] as never);

		const result = await caller.dashboard.demographics({ top: 7 });
		expect(result.universityLabel).toBe('Where do you study?');
		expect(result.yearLabel).toBe('Class standing');
	});

	it('is refused to organizers — headcounts of one are per-person data', async () => {
		const caller = createTestCaller(db, organizerUser);
		await expect(caller.dashboard.demographics({ top: 7 })).rejects.toThrow();
	});
});
