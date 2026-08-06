import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { CLAIM_TTL_MS } from '$lib/admissions/lock';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import {
	createTestCaller,
	adminUser,
	adminUser2,
	claimedHacker,
	hackerUser,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendTemplatedEmail } = await import('$lib/server/email');

/**
 * Frozen clock. Nothing in the router uses timers — we only need Date.now() to be
 * deterministic so the exact staleThreshold Date can be asserted against the mock.
 */
const NOW = new Date('2024-06-01T12:00:00Z');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendTemplatedEmail).mockClear();
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	// `list` folds the blacklist to flag applicants; default to empty so tests that are
	// about filtering don't each have to say they aren't about the blacklist.
	db.blacklist.findMany.mockResolvedValue([] as never);
});

afterEach(() => {
	vi.useRealTimers();
});

/** Mirrors the router's `claimableBy` predicate: unclaimed, mine, or stale. */
function claimableWhere(uid: string, adminUid: string) {
	return {
		uid,
		OR: [
			{ claimedBy: null },
			{ claimedBy: adminUid },
			{ claimedAt: { lt: new Date(NOW.getTime() - CLAIM_TTL_MS) } }
		]
	};
}

/** Prisma's "where clause matched no row" error, as thrown by `update`. */
function recordNotFound() {
	return Object.assign(new Error('No record was found for an update.'), {
		code: 'P2025'
	});
}

const pendingUser = {
	...hackerUser,
	uid: 'pending-uid',
	email: 'pending@example.com',
	pendingDecision: DecisionStatus.ACCEPTED
};

describe('admissions.list', () => {
	it('returns all users with no filters', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, pendingUser] as never);
		const result = await caller.admissions.list({});
		expect(result).toHaveLength(2);
	});

	it('reports no blacklist match when the table is empty', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		const result = await caller.admissions.list({});
		expect(result[0].blacklistMatch).toBeNull();
	});

	it('flags an applicant whose email is blacklisted', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: '', lastName: '', email: hackerUser.email.toLowerCase() }
		] as never);

		const result = await caller.admissions.list({});
		expect(result[0].blacklistMatch).toBe('EMAIL');
	});

	it('flags an applicant whose name is blacklisted, without deciding anything', async () => {
		const caller = createTestCaller(db, adminUser);
		const [first, last] = hackerUser.name.split(' ');
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: first, lastName: last, email: null }
		] as never);

		const result = await caller.admissions.list({});
		expect(result[0].blacklistMatch).toBe('NAME_EXACT');
		expect(result[0].pendingDecision).toBe(hackerUser.pendingDecision);
	});

	it('catches an entry added after the applicant already applied', async () => {
		// The flag is computed per request rather than stored at submit time, which is the
		// whole reason a late addition still shows up here.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: '', lastName: '', email: pendingUser.email }
		] as never);

		const result = await caller.admissions.list({});
		expect(result[0].blacklistMatch).toBe('EMAIL');
	});

	it('filters by roles', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		await caller.admissions.list({ roles: [Role.HACKER] });
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: expect.arrayContaining([{ role: { in: [Role.HACKER] } }]) }
			})
		);
	});

	it('bounds the queue to applicant roles when no filter is given', async () => {
		// The "All" tab sends no roles, which must still mean "all applicants" rather
		// than "all users" — staff have no application to review.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		await caller.admissions.list({});
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: expect.arrayContaining([{ role: { in: APPLICANT_ROLES } }]) }
			})
		);
		expect(APPLICANT_ROLES).not.toContain(Role.ORGANIZER);
		expect(APPLICANT_ROLES).not.toContain(Role.ADMIN);
	});

	it('drops staff roles from an explicit filter', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		await caller.admissions.list({ roles: [Role.HACKER, Role.ORGANIZER] });
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: expect.arrayContaining([{ role: { in: [Role.HACKER] } }]) }
			})
		);
	});

	it('returns nothing for a staff-only filter, without querying', async () => {
		const caller = createTestCaller(db, adminUser);
		const result = await caller.admissions.list({
			roles: [Role.ORGANIZER, Role.ADMIN]
		});
		expect(result).toEqual([]);
		expect(db.user.findMany).not.toHaveBeenCalled();
	});

	it('filters by decision', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		await caller.admissions.list({ decision: DecisionStatus.ACCEPTED });
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					AND: expect.arrayContaining([
						{
							OR: [
								{ pendingDecision: DecisionStatus.ACCEPTED },
								{ activeDecision: DecisionStatus.ACCEPTED }
							]
						}
					])
				}
			})
		);
	});

	it('keeps the decision filter when a search term is also present', async () => {
		// Regression: both filters used to write a top-level `OR`, so search silently
		// overwrote the decision clause and returned matches of any decision.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		await caller.admissions.list({ decision: DecisionStatus.ACCEPTED, search: 'ana' });
		const where = db.user.findMany.mock.calls[0]?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ pendingDecision: DecisionStatus.ACCEPTED },
				{ activeDecision: DecisionStatus.ACCEPTED }
			]
		});
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'ana', mode: 'insensitive' } },
				{ email: { contains: 'ana', mode: 'insensitive' } }
			]
		});
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.list({})).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions.claim', () => {
	/** claim issues two updateMany calls: [0] drop my other claims, [1] the CAS. */
	function mockClaimResult(count: number) {
		db.user.updateMany
			.mockResolvedValueOnce({ count: 0 } as never)
			.mockResolvedValueOnce({ count } as never);
	}

	it('claims an unclaimed applicant', async () => {
		const caller = createTestCaller(db, adminUser);
		mockClaimResult(1);

		const result = await caller.admissions.claim({ uid: hackerUser.uid });

		expect(result).toEqual({
			claimed: true,
			claimerName: null,
			expiresInMs: CLAIM_TTL_MS
		});
	});

	it("releases this admin's other claims first", async () => {
		const caller = createTestCaller(db, adminUser);
		mockClaimResult(1);

		await caller.admissions.claim({ uid: hackerUser.uid });

		expect(db.user.updateMany.mock.calls[0]?.[0]).toEqual({
			where: { claimedBy: adminUser.uid, uid: { not: hackerUser.uid } },
			data: { claimedBy: null, claimedAt: null }
		});
	});

	it('uses the lenient claimable predicate for the CAS', async () => {
		const caller = createTestCaller(db, adminUser);
		mockClaimResult(1);

		await caller.admissions.claim({ uid: hackerUser.uid });

		expect(db.user.updateMany.mock.calls[1]?.[0]).toEqual({
			where: claimableWhere(hackerUser.uid, adminUser.uid),
			data: { claimedBy: adminUser.uid, claimedAt: NOW }
		});
	});

	it('reports the holder when another admin has a fresh claim', async () => {
		const caller = createTestCaller(db, adminUser);
		mockClaimResult(0);
		db.user.findUnique.mockResolvedValue({
			claimer: { name: adminUser2.name }
		} as never);

		const result = await caller.admissions.claim({ uid: claimedHacker.uid });

		expect(result).toEqual({
			claimed: false,
			claimerName: 'Second Admin',
			expiresInMs: null
		});
	});

	it('falls back to a generic holder name when the claimer is missing', async () => {
		const caller = createTestCaller(db, adminUser);
		mockClaimResult(0);
		db.user.findUnique.mockResolvedValue({ claimer: null } as never);

		const result = await caller.admissions.claim({ uid: claimedHacker.uid });

		expect(result.claimerName).toBe('Another admin');
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.claim({ uid: hackerUser.uid })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions.heartbeat', () => {
	it('refreshes a claim this admin holds', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);

		const result = await caller.admissions.heartbeat({ uid: hackerUser.uid });

		expect(result).toEqual({ refreshed: true, expiresInMs: CLAIM_TTL_MS });
		expect(db.user.updateMany).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid, claimedBy: adminUser.uid },
			data: { claimedAt: NOW }
		});
	});

	it('reports not refreshed when the claim has moved on', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 0 } as never);

		const result = await caller.admissions.heartbeat({ uid: hackerUser.uid });

		expect(result).toEqual({ refreshed: false, expiresInMs: null });
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.heartbeat({ uid: hackerUser.uid })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions.releaseClaim', () => {
	it("is scoped to this admin's own claim", async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);

		const result = await caller.admissions.releaseClaim({
			uid: hackerUser.uid
		});

		expect(result).toEqual({ ok: true });
		expect(db.user.updateMany).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid, claimedBy: adminUser.uid },
			data: { claimedBy: null, claimedAt: null }
		});
	});

	it('is a no-op when someone else holds the claim', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 0 } as never);

		const result = await caller.admissions.releaseClaim({
			uid: claimedHacker.uid
		});

		expect(result).toEqual({ ok: true });
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.releaseClaim({ uid: hackerUser.uid })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions.presence', () => {
	it('only considers claims that have not gone stale', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		await caller.admissions.presence();

		expect(db.user.findMany.mock.calls[0]?.[0]?.where).toEqual({
			claimedBy: { not: null },
			claimedAt: { gt: new Date(NOW.getTime() - CLAIM_TTL_MS) }
		});
	});

	it('returns remaining lock time as a duration', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([
			{
				uid: claimedHacker.uid,
				claimedBy: adminUser2.uid,
				claimedAt: new Date(NOW.getTime() - 30_000),
				claimer: { name: adminUser2.name }
			}
		] as never);

		const result = await caller.admissions.presence();

		expect(result).toEqual([
			{
				uid: claimedHacker.uid,
				claimedBy: adminUser2.uid,
				claimerName: 'Second Admin',
				expiresInMs: CLAIM_TTL_MS - 30_000
			}
		]);
	});

	it('falls back to a generic name when the claimer is missing', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([
			{
				uid: claimedHacker.uid,
				claimedBy: adminUser2.uid,
				claimedAt: NOW,
				claimer: null
			}
		] as never);

		const result = await caller.admissions.presence();

		expect(result[0]?.claimerName).toBe('Admin');
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.presence()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions.setDecision', () => {
	it('sets pendingDecision and releases the claim', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue({
			...hackerUser,
			pendingDecision: DecisionStatus.ACCEPTED
		} as never);

		const result = await caller.admissions.setDecision({
			uid: hackerUser.uid,
			decision: DecisionStatus.ACCEPTED
		});

		expect(result.pendingDecision).toBe(DecisionStatus.ACCEPTED);
		expect(db.user.update).toHaveBeenCalledWith({
			where: claimableWhere(hackerUser.uid, adminUser.uid),
			data: {
				pendingDecision: DecisionStatus.ACCEPTED,
				claimedBy: null,
				claimedAt: null
			}
		});
	});

	it('does NOT touch activeDecision', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue(hackerUser as never);

		await caller.admissions.setDecision({
			uid: hackerUser.uid,
			decision: DecisionStatus.REJECTED
		});

		const callArg = db.user.update.mock.calls[0]?.[0];
		expect(callArg?.data).not.toHaveProperty('activeDecision');
	});

	it('throws CONFLICT naming the holder when another admin has it locked', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(recordNotFound());
		db.user.findUnique.mockResolvedValue({
			name: claimedHacker.name,
			claimer: { name: adminUser2.name }
		} as never);
		db.log.create.mockResolvedValue({} as never);

		await expect(
			caller.admissions.setDecision({
				uid: claimedHacker.uid,
				decision: DecisionStatus.ACCEPTED
			})
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message: expect.stringContaining('Second Admin')
		});
	});

	it('logs an audit entry when a decision is blocked', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(recordNotFound());
		db.user.findUnique.mockResolvedValue({
			name: claimedHacker.name,
			claimer: { name: adminUser2.name }
		} as never);
		db.log.create.mockResolvedValue({} as never);

		await expect(
			caller.admissions.setDecision({
				uid: claimedHacker.uid,
				decision: DecisionStatus.ACCEPTED
			})
		).rejects.toThrow();

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.decision.blocked',
					summary: expect.stringContaining(adminUser2.name),
					actorId: adminUser.uid,
					targetId: claimedHacker.uid,
					metadata: expect.objectContaining({
						decision: DecisionStatus.ACCEPTED,
						heldBy: adminUser2.name
					})
				})
			})
		);
	});

	it('throws NOT_FOUND when the applicant does not exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(recordNotFound());
		db.user.findUnique.mockResolvedValue(null as never);

		await expect(
			caller.admissions.setDecision({
				uid: 'ghost-uid',
				decision: DecisionStatus.ACCEPTED
			})
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('re-throws errors that are not a missed where clause', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(
			Object.assign(new Error('connection lost'), { code: 'P1001' })
		);

		await expect(
			caller.admissions.setDecision({
				uid: hackerUser.uid,
				decision: DecisionStatus.ACCEPTED
			})
		).rejects.toThrow('connection lost');
		expect(db.user.findUnique).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.admissions.setDecision({
				uid: hackerUser.uid,
				decision: DecisionStatus.ACCEPTED
			})
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('admissions.release', () => {
	it('copies pending→active for all matched users', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		// Each swap reports one row updated (the compare-and-swap took).
		db.$transaction.mockResolvedValue([{ count: 1 }]);

		const result = await caller.admissions.release({});
		expect(result).toEqual({ released: 1 });
		expect(db.$transaction).toHaveBeenCalled();
		// updateMany is the compare-and-swap: keyed on the exact pending value we read.
		expect(db.user.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: pendingUser.uid, pendingDecision: pendingUser.pendingDecision },
				data: {
					activeDecision: pendingUser.pendingDecision,
					pendingDecision: null,
					claimedBy: null,
					claimedAt: null
				}
			})
		);
	});

	it('clears the review claim on promoted users', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([{ count: 1 }]);

		await caller.admissions.release({});

		const data = db.user.updateMany.mock.calls[0]?.[0]?.data;
		expect(data).toMatchObject({ claimedBy: null, claimedAt: null });
	});

	it('creates log entry after release', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([{ count: 1 }]);

		await caller.admissions.release({});

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.release',
					summary: expect.stringContaining('Released 1 decision'),
					actorId: adminUser.uid,
					metadata: expect.objectContaining({ released: 1, scope: 'all pending' })
				})
			})
		);
	});

	it('calls email for each decision type when settings exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([{ count: 1 }]);

		await caller.admissions.release({});

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			pendingUser.email,
			{ subject: mockSettings.acceptSubject, body: mockSettings.acceptTemplate },
			expect.objectContaining({ name: pendingUser.name })
		);
	});

	it('throws BAD_REQUEST when no pending decisions exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		await expect(caller.admissions.release({})).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
	});
});
