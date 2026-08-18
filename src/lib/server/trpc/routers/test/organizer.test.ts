import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { ScheduleType } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	adminUser,
	organizerUser,
	hackerUser,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
	sendEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => {
	mockReset(db);
});

/**
 * Prisma's `groupBy` is overloaded enough that vitest-mock-extended's methods aren't
 * visible on it through the types — scan.test.ts and dashboard.test.ts hit the same
 * wall. Cast in one place instead of at every call site.
 */
function mockGroupBy(fn: unknown, value: unknown) {
	(fn as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(value);
}

/**
 * The organizer boundary, asserted in one place.
 *
 * ORGANIZER used to be a straight alias for ADMIN, so every one of these calls
 * succeeded. Hiding the nav links doesn't change that — these procedures are reachable
 * at /api/trpc/* regardless — which is why the boundary is tested at this layer rather
 * than through the pages.
 */
describe('organizer is denied everything holding user data', () => {
	const denied: Record<string, (c: ReturnType<typeof createTestCaller>) => Promise<unknown>> = {
		'user.list': (c) => c.user.list({ page: 1, pageSize: 10 }),
		'user.getById': (c) => c.user.getById({ uid: hackerUser.uid }),
		'user.updateRole': (c) => c.user.updateRole({ uid: hackerUser.uid, role: 'HACKER' as never }),
		'user.exportCsv': (c) => c.user.exportCsv(),
		'admissions.list': (c) => c.admissions.list({}),
		'admissions.presence': (c) => c.admissions.presence(),
		'admissions.setDecision': (c) =>
			c.admissions.setDecision({ uid: hackerUser.uid, decision: 'ACCEPTED' as never }),
		'blacklist.list': (c) => c.blacklist.list(),
		// Aggregate counts, but of a named applicant pool — at a count of one they are
		// per-person data, and no organizer-reachable page uses them.
		'filters.facets': (c) => c.filters.facets(),
		'blacklist.add': (c) =>
			c.blacklist.add({ firstName: 'A', lastName: 'B', email: 'a@b.com' } as never),
		'email.sendCustom': (c) => c.email.sendCustom({ subject: 's', body: 'b' } as never),
		'email.getLogs': (c) => c.email.getLogs({} as never),
		'log.list': (c) => c.log.list({} as never),
		'settings.update': (c) => c.settings.update(mockSettings as never),
		'dashboard.recentApplicants': (c) => c.dashboard.recentApplicants({ amount: 10 }),
		// The application editor defines what gets asked of applicants — admin only.
		'questions.listAll': (c) => c.questions.listAll(),
		'questions.create': (c) => c.questions.create({ title: 'Q', type: 'SHORT_TEXT' } as never),
		'questions.delete': (c) => c.questions.delete({ id: 'q1' } as never),
		// The whole database, read out or destroyed. Both also demand a password an
		// organizer has no more access to than an admin does — but the role gate is
		// what has to fail first, before anything reads the environment.
		'data.exportAll': (c) => c.data.exportAll({ password: 'x' }),
		'data.wipe': (c) => c.data.wipe({ password: 'x', confirm: 'WIPE' })
	};

	/** The tRPC error code a call rejected with, or null if it got through. */
	async function errorCode(p: Promise<unknown>): Promise<string | null> {
		return p.then(
			() => null,
			(e: { code?: string }) => e?.code ?? null
		);
	}

	for (const [name, call] of Object.entries(denied)) {
		it(`${name} throws FORBIDDEN`, async () => {
			const caller = createTestCaller(db, organizerUser);
			await expect(call(caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it(`${name} is not a permission failure for an admin`, async () => {
			// Only asserts the gate lets an admin past. Behavior belongs to each router's
			// own suite, so an unmocked db call failing some other way is fine here.
			const caller = createTestCaller(db, adminUser);
			expect(await errorCode(call(caller))).not.toBe('FORBIDDEN');
		});
	}
});

describe('organizer keeps the sections with no per-person data', () => {
	it('can look up a scan', async () => {
		db.settings.findFirst.mockResolvedValue(mockSettings as never);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.scan.findFirst.mockResolvedValue(null as never);
		db.scan.count.mockResolvedValue(0 as never);

		const caller = createTestCaller(db, organizerUser);
		await expect(
			caller.scan.lookup({ userCode: hackerUser.uid, action: 'Check-In' })
		).resolves.toBeDefined();
	});

	it('can read scan counts', async () => {
		db.settings.findFirst.mockResolvedValue(mockSettings as never);
		mockGroupBy(db.scan.groupBy, []);
		const caller = createTestCaller(db, organizerUser);
		await expect(caller.scan.getCounts()).resolves.toBeDefined();
	});

	it('can create a schedule event', async () => {
		// Full row shape: the endpoint audit-logs from the created event, reading
		// its name and start/end dates.
		db.schedule.create.mockResolvedValue({
			id: 's1',
			name: 'Opening',
			start: new Date('2024-04-15'),
			end: new Date('2024-04-15'),
			location: 'Main Hall',
			type: ScheduleType.CEREMONY
		} as never);
		const caller = createTestCaller(db, organizerUser);
		await expect(
			caller.schedule.create({
				name: 'Opening',
				start: new Date('2024-04-15'),
				end: new Date('2024-04-15'),
				location: 'Main Hall',
				type: ScheduleType.CEREMONY
			} as never)
		).resolves.toBeDefined();
	});

	it("is still refused when it isn't staff at all", async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.scan.getCounts()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('dashboard.stats withholds named users from organizers', () => {
	beforeEach(() => {
		db.user.count.mockResolvedValue(5 as never);
		mockGroupBy(db.user.groupBy, []);
		db.user.findMany.mockResolvedValue([] as never);
		db.log.findMany.mockResolvedValue([
			{
				id: 'l1',
				action: 'applied',
				timestamp: new Date(),
				userId: hackerUser.uid,
				user: hackerUser
			}
		] as never);
	});

	it('returns aggregates but no activity feed for an organizer', async () => {
		const caller = createTestCaller(db, organizerUser);
		const stats = await caller.dashboard.stats();

		expect(stats.total).toBe(5);
		expect(stats.recentActivity).toBeNull();
		// The named-user query must not run at all, not merely be discarded.
		expect(db.log.findMany).not.toHaveBeenCalled();
	});

	it('returns the activity feed for an admin', async () => {
		const caller = createTestCaller(db, adminUser);
		const stats = await caller.dashboard.stats();

		expect(stats.total).toBe(5);
		expect(stats.recentActivity).toHaveLength(1);
	});
});
