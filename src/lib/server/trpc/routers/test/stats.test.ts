import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	adminUser,
	adminUser2,
	organizerUser,
	hackerUser,
	mockGroupBy
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

/** One `user.groupBy` row as the decision query returns it. */
function decisionRow(
	decidedBy: string | null,
	pendingDecision: DecisionStatus | null,
	activeDecision: DecisionStatus | null,
	count: number
) {
	return { decidedBy, pendingDecision, activeDecision, _count: { _all: count } };
}

/**
 * The router issues, in order: `user.groupBy` (decisions), `log.findMany`
 * (emails), `log.groupBy` (scans), then `user.findMany` (names).
 */
function mockStats(options: {
	decisions?: ReturnType<typeof decisionRow>[];
	emails?: { actorId: string | null; metadata: unknown }[];
	scans?: { actorId: string | null; _count: { _all: number } }[];
	people?: { uid: string; name: string; role: Role }[];
}) {
	mockGroupBy(db.user.groupBy).mockResolvedValue((options.decisions ?? []) as never);
	db.log.findMany.mockResolvedValue((options.emails ?? []) as never);
	mockGroupBy(db.log.groupBy).mockResolvedValue((options.scans ?? []) as never);
	db.user.findMany.mockResolvedValue((options.people ?? []) as never);
}

describe('stats.byAdmin', () => {
	it('attributes decisions to the admin who made them', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			decisions: [
				decisionRow(adminUser.uid, DecisionStatus.ACCEPTED, null, 22),
				decisionRow(adminUser.uid, DecisionStatus.REJECTED, null, 18),
				decisionRow(adminUser.uid, DecisionStatus.WAITLISTED, null, 9)
			],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins).toHaveLength(1);
		expect(result.admins[0]).toMatchObject({
			uid: adminUser.uid,
			accepted: 22,
			rejected: 18,
			waitlisted: 9,
			decisions: 49
		});
	});

	it('falls back to activeDecision once a decision has been released', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			// Released: pendingDecision is cleared, activeDecision carries the outcome.
			decisions: [decisionRow(adminUser.uid, null, DecisionStatus.ACCEPTED, 5)],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].accepted).toBe(5);
	});

	it('counts a pending decision once, not twice, when both fields are set', async () => {
		const caller = createTestCaller(db, adminUser);

		// Mid-flight: a new pending decision sitting on top of a released one. Only
		// the pending one stands, so ACCEPTED must not also be credited.
		mockStats({
			decisions: [decisionRow(adminUser.uid, DecisionStatus.REJECTED, DecisionStatus.ACCEPTED, 3)],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].rejected).toBe(3);
		expect(result.admins[0].accepted).toBe(0);
		expect(result.admins[0].decisions).toBe(3);
	});

	it('reports decisions with no admin as unattributed rather than dropping them', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			decisions: [
				decisionRow(adminUser.uid, DecisionStatus.ACCEPTED, null, 4),
				// The blacklist auto-reject in application.submit — no admin acted.
				decisionRow(null, DecisionStatus.REJECTED, null, 6)
			],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].accepted).toBe(4);
		expect(result.unattributed).toEqual({
			accepted: 0,
			rejected: 6,
			waitlisted: 0,
			total: 6
		});
	});

	it('ignores undecided applicants and the PENDING placeholder', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			decisions: [
				decisionRow(null, null, null, 740),
				decisionRow(adminUser.uid, DecisionStatus.PENDING, null, 12),
				decisionRow(adminUser.uid, DecisionStatus.ACCEPTED, null, 1)
			],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].decisions).toBe(1);
		expect(result.unattributed.total).toBe(0);
	});

	it('counts email campaigns and subtracts failures from recipients', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			emails: [
				{ actorId: adminUser.uid, metadata: { recipients: 400, failed: 0 } },
				{ actorId: adminUser.uid, metadata: { recipients: 300, failed: 20 } }
			],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].emailCampaigns).toBe(2);
		expect(result.admins[0].emailRecipients).toBe(680);
	});

	it('treats missing or malformed metadata as zero rather than NaN', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			emails: [
				{ actorId: adminUser.uid, metadata: null },
				{ actorId: adminUser.uid, metadata: { recipients: 'lots' } },
				{ actorId: adminUser.uid, metadata: { recipients: 10, failed: 1 } }
			],
			people: [{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN }]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins[0].emailCampaigns).toBe(3);
		expect(result.admins[0].emailRecipients).toBe(9);
	});

	it('zero-fills staff with no activity', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			decisions: [decisionRow(adminUser.uid, DecisionStatus.ACCEPTED, null, 2)],
			people: [
				{ uid: adminUser.uid, name: adminUser.name, role: Role.ADMIN },
				{ uid: organizerUser.uid, name: organizerUser.name, role: Role.ORGANIZER }
			]
		});

		const result = await caller.stats.byAdmin({});

		const idle = result.admins.find((a) => a.uid === organizerUser.uid);
		expect(idle).toMatchObject({
			accepted: 0,
			rejected: 0,
			waitlisted: 0,
			decisions: 0,
			emailCampaigns: 0,
			emailRecipients: 0,
			scans: 0
		});
	});

	it('ranks by decision volume, then by name', async () => {
		const caller = createTestCaller(db, adminUser);

		mockStats({
			decisions: [
				decisionRow(adminUser.uid, DecisionStatus.ACCEPTED, null, 1),
				decisionRow(adminUser2.uid, DecisionStatus.ACCEPTED, null, 9)
			],
			people: [
				{ uid: adminUser.uid, name: 'Zoe', role: Role.ADMIN },
				{ uid: adminUser2.uid, name: 'Adam', role: Role.ADMIN }
			]
		});

		const result = await caller.stats.byAdmin({});

		expect(result.admins.map((a) => a.name)).toEqual(['Adam', 'Zoe']);
	});

	it('scopes both decisions and events when a window is given', async () => {
		const caller = createTestCaller(db, adminUser);
		mockStats({});

		const from = new Date('2026-01-01');
		await caller.stats.byAdmin({ from });

		// Decisions window on decidedAt; events on the log's own timestamp.
		expect(db.user.groupBy).toHaveBeenCalledWith(
			expect.objectContaining({ where: { decidedAt: { gte: from } } })
		);
		expect(db.log.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ timestamp: { gte: from } })
			})
		);
	});

	it('applies no date filter for the all-time window', async () => {
		const caller = createTestCaller(db, adminUser);
		mockStats({});

		await caller.stats.byAdmin({});

		expect(db.user.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
	});

	it('throws FORBIDDEN for organizers — this names staff, unlike dashboard.stats', async () => {
		const caller = createTestCaller(db, organizerUser);
		await expect(caller.stats.byAdmin({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('throws FORBIDDEN for non-staff', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.stats.byAdmin({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
