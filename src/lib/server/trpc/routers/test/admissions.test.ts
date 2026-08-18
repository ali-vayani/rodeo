import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { CLAIM_TTL_MS } from '$lib/admissions/lock';
import { APPLICANT_ROLES } from '$lib/admissions/roles';
import { NO_VALUE } from '$lib/linkedFields';
import { EXACT_MATCH_FLOOR, MAX_FUZZY_NAMES, NO_EXPANSION } from '$lib/server/recipients';
import {
	createTestCaller,
	adminUser,
	adminUser2,
	claimedHacker,
	hackerUser,
	mockGroupBy,
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
		role: { in: APPLICANT_ROLES },
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
		expect(result.applicants).toHaveLength(2);
	});

	it('reports no blacklist match when the table is empty', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		const result = await caller.admissions.list({});
		expect(result.applicants[0].blacklistMatch).toBeNull();
	});

	it('flags an applicant whose email is blacklisted', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: '', lastName: '', email: hackerUser.email.toLowerCase() }
		] as never);

		const result = await caller.admissions.list({});
		expect(result.applicants[0].blacklistMatch).toBe('EMAIL');
	});

	it('flags an applicant whose name is blacklisted, without deciding anything', async () => {
		const caller = createTestCaller(db, adminUser);
		const [first, last] = hackerUser.name.split(' ');
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: first, lastName: last, email: null }
		] as never);

		const result = await caller.admissions.list({});
		expect(result.applicants[0].blacklistMatch).toBe('NAME_EXACT');
		expect(result.applicants[0].pendingDecision).toBe(hackerUser.pendingDecision);
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
		expect(result.applicants[0].blacklistMatch).toBe('EMAIL');
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
		expect(result.applicants).toEqual([]);
		expect(result.search).toEqual(NO_EXPANSION);
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
		// The term returns a real result set, so the fuzzy fold stays out of the way and
		// the only findMany is the listing itself.
		db.user.count.mockResolvedValue(EXACT_MATCH_FLOOR as never);
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
				// Attribution rides along in the same statement as the decision — the
				// CAS above can miss, and an attribution that could land without its
				// decision is exactly the drift this column exists to prevent.
				decidedBy: adminUser.uid,
				decidedAt: new Date(),
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

	/**
	 * Release publishes decisions other admins made. Crediting the releaser would
	 * hand one person the entire batch and erase the reviewers who did the work —
	 * so the attribution columns must survive the promotion untouched.
	 */
	it('leaves decision attribution with the original reviewer', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([{ count: 1 }]);

		await caller.admissions.release({});

		const data = db.user.updateMany.mock.calls[0]?.[0]?.data;
		expect(data).not.toHaveProperty('decidedBy');
		expect(data).not.toHaveProperty('decidedAt');
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
			expect.objectContaining({ name: pendingUser.name }),
			// An acceptance goes out before the recipient has RSVP'd, so there is no
			// check-in block yet and nothing to attach.
			[]
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

describe('admissions.list — linked application fields', () => {
	/** The AND conditions the router handed Prisma. */
	function whereConditions() {
		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		return where.AND;
	}

	beforeEach(() => {
		db.user.findMany.mockResolvedValue([hackerUser] as never);
	});

	it('filters by university with an exact IN', async () => {
		await createTestCaller(db, adminUser).admissions.list({ universities: ['Rice University'] });
		expect(whereConditions()).toContainEqual({ university: { in: ['Rice University'] } });
	});

	it('matches nothing when a linked filter is engaged but empty', async () => {
		// Same rule as the recipient predicate, and the reason the clause is shared:
		// these two lists must never disagree about what an empty selection means.
		await createTestCaller(db, adminUser).admissions.list({ years: [] });
		expect(whereConditions()).toContainEqual({ uid: 'IMPOSSIBLE_NO_MATCH' });
	});

	it('adds no clause at all when the linked filters are absent', async () => {
		await createTestCaller(db, adminUser).admissions.list({});
		expect(JSON.stringify(whereConditions())).not.toContain('university');
	});

	it('selects both spellings of absent for the NO_VALUE sentinel', async () => {
		await createTestCaller(db, adminUser).admissions.list({ universities: [NO_VALUE] });
		expect(whereConditions()).toContainEqual({
			OR: [{ university: null }, { university: '' }]
		});
	});

	it('ANDs linked fields with the decision filter rather than replacing it', async () => {
		await createTestCaller(db, adminUser).admissions.list({
			decision: DecisionStatus.ACCEPTED,
			universities: ['Rice University']
		});
		const cond = whereConditions();
		expect(cond).toContainEqual({
			OR: [
				{ pendingDecision: DecisionStatus.ACCEPTED },
				{ activeDecision: DecisionStatus.ACCEPTED }
			]
		});
		expect(cond).toContainEqual({ university: { in: ['Rice University'] } });
	});

	it('still matches pendingDecision OR activeDecision, unlike the recipient predicate', async () => {
		// The two predicates share their search and linked-field clauses but must NOT
		// be unified: the admissions queue reviews unreleased decisions, mail does not.
		await createTestCaller(db, adminUser).admissions.list({ decision: DecisionStatus.ACCEPTED });
		expect(JSON.stringify(whereConditions())).toContain('pendingDecision');
	});
});

describe('admissions.list — typo-tolerant search', () => {
	beforeEach(() => {
		db.user.findMany.mockResolvedValue([hackerUser] as never);
	});

	it('leaves a productive search alone, without scanning names', async () => {
		db.user.count.mockResolvedValue(EXACT_MATCH_FLOOR as never);
		await createTestCaller(db, adminUser).admissions.list({ search: 'Hacker' });

		// One findMany: the listing itself. No fold, no widened predicate.
		expect(db.user.findMany).toHaveBeenCalledTimes(1);
		const where = db.user.findMany.mock.calls[0]?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'Hacker', mode: 'insensitive' } },
				{ email: { contains: 'Hacker', mode: 'insensitive' } }
			]
		});
	});

	it('falls back to close names when the typed term matches nobody', async () => {
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany
			.mockResolvedValueOnce([{ name: 'Hacker User' }] as never)
			.mockResolvedValueOnce([hackerUser] as never);

		await createTestCaller(db, adminUser).admissions.list({ search: 'Hackr' });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'Hackr', mode: 'insensitive' } },
				{ email: { contains: 'Hackr', mode: 'insensitive' } },
				{ name: { in: ['Hacker User'] } }
			]
		});
	});

	it('reports no fallback for a term that matched exactly', async () => {
		// The strip must stay hidden when the typed term was fine — `fuzzy` is what the
		// UI gates on, so a productive search reporting anything else would show a
		// "did you mean" over results the admin explicitly asked for.
		db.user.count.mockResolvedValue(EXACT_MATCH_FLOOR as never);
		const result = await createTestCaller(db, adminUser).admissions.list({ search: 'Hacker' });
		expect(result.search).toEqual({ ...NO_EXPANSION, exact: EXACT_MATCH_FLOOR });
	});

	it('reports the fallback names, ranked, when the term matched nobody', async () => {
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany
			// Neither contains the typed term, so both are genuine suggestions. A candidate
			// spelled exactly like the query would not be one — the substring clause has it.
			.mockResolvedValueOnce([{ name: 'Hacker User' }, { name: 'Hacker Userz' }] as never)
			.mockResolvedValueOnce([hackerUser] as never);

		const result = await createTestCaller(db, adminUser).admissions.list({ search: 'Hackr Userz' });

		expect(result.search.fuzzy).toBe(true);
		expect(result.search.capped).toBe(false);
		// Ranked by mean similarity across query tokens, so the closer name leads.
		expect(result.search.names).toEqual(['Hacker Userz', 'Hacker User']);
	});

	it('reports a truncated suggestion list rather than swallowing the cap', async () => {
		// A capped list is a different answer from a complete one, and the strip says
		// "showing the N closest" off this flag.
		db.user.count.mockResolvedValue(0 as never);
		const nearMisses = Array.from({ length: MAX_FUZZY_NAMES + 1 }, (_, i) => ({
			name: `Hacker User ${i}`
		}));
		db.user.findMany
			.mockResolvedValueOnce(nearMisses as never)
			.mockResolvedValueOnce([hackerUser] as never);

		const result = await createTestCaller(db, adminUser).admissions.list({ search: 'Hackr' });

		expect(result.search.capped).toBe(true);
		expect(result.search.names).toHaveLength(MAX_FUZZY_NAMES);
	});

	it('describes the same expansion the rows were selected with', async () => {
		// One `expandSearch` call feeding both the predicate and the response — a second
		// call could disagree with the first, and the strip would then be captioning a
		// result set it did not produce.
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany
			.mockResolvedValueOnce([{ name: 'Hacker User' }] as never)
			.mockResolvedValueOnce([hackerUser] as never);

		const result = await createTestCaller(db, adminUser).admissions.list({ search: 'Hackr' });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'Hackr', mode: 'insensitive' } },
				{ email: { contains: 'Hackr', mode: 'insensitive' } },
				{ name: { in: result.search.names } }
			]
		});
	});

	/**
	 * The live bug: `adm` had 8 exact substring hits across the whole `User` table —
	 * `admin1@yopmail.com`…`admin5@yopmail.com` plus three undeclared accounts — so the
	 * probe cleared the floor and skipped the fold. None of them are applicants, so the
	 * queue came back empty *and* never offered `Adam Hmaidan`. The probe has to be
	 * counted inside the queue's own predicate, not across the table.
	 */
	describe('the exact-match probe is scoped to the queue', () => {
		/** The AND conditions of the count `expandSearch` probed with. */
		function probeConditions() {
			const where = db.user.count.mock.calls[0]?.[0]?.where as { AND: unknown[] };
			return where.AND;
		}

		it('probes within the applicant-role bound', async () => {
			db.user.count.mockResolvedValue(0 as never);
			db.user.findMany.mockResolvedValueOnce([{ name: 'Adam Hmaidan' }] as never);

			await createTestCaller(db, adminUser).admissions.list({ search: 'adm' });

			expect(probeConditions()).toContainEqual({ role: { in: APPLICANT_ROLES } });
		});

		it('probes within the decision tab and the linked-field filters too', async () => {
			db.user.count.mockResolvedValue(0 as never);
			db.user.findMany.mockResolvedValueOnce([] as never);

			await createTestCaller(db, adminUser).admissions.list({
				search: 'adm',
				decision: DecisionStatus.ACCEPTED,
				universities: ['Rice University']
			});

			const probe = probeConditions();
			expect(probe).toContainEqual({
				OR: [
					{ pendingDecision: DecisionStatus.ACCEPTED },
					{ activeDecision: DecisionStatus.ACCEPTED }
				]
			});
			expect(probe).toContainEqual({ university: { in: ['Rice University'] } });
			// The scope is everything BUT the search clause, and the probe appends the bare
			// substring test to it. It can never carry the expanded `name: { in: [...] }`
			// half — that is built from the expansion this very probe decides.
			expect(JSON.stringify(probe.slice(0, -1))).not.toContain('contains');
			expect(JSON.stringify(probe)).not.toContain('"in":["Adam');
			expect(probe.at(-1)).toEqual({
				OR: [
					{ name: { contains: 'adm', mode: 'insensitive' } },
					{ email: { contains: 'adm', mode: 'insensitive' } }
				]
			});
		});

		it('folds and suggests a name the global count would have suppressed', async () => {
			// 0 in scope; the eight out-of-scope hits are no longer consulted.
			db.user.count.mockResolvedValue(0 as never);
			db.user.findMany
				.mockResolvedValueOnce([{ name: 'Adam Hmaidan' }, { name: 'Admin User' }] as never)
				.mockResolvedValueOnce([hackerUser] as never);

			const result = await createTestCaller(db, adminUser).admissions.list({ search: 'adm' });

			expect(result.search.fuzzy).toBe(true);
			expect(result.search.names).toContain('Adam Hmaidan');
		});
	});

	it('keeps the applicant-role bound even when the fuzzy fold widens the search', async () => {
		// The fold scans every distinct name, staff included; the role clause is what
		// keeps an admin whose name is a near miss out of the review queue.
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany
			.mockResolvedValueOnce([{ name: 'Admin User' }] as never)
			.mockResolvedValueOnce([] as never);

		await createTestCaller(db, adminUser).admissions.list({ search: 'Admn' });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({ role: { in: APPLICANT_ROLES } });
	});
});

describe('admissions.setScore', () => {
	it('saves the score with its attribution and releases the claim', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue({ ...hackerUser, score: 17 } as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.admissions.setScore({
			uid: hackerUser.uid,
			score: 17,
			notes: 'Strong project history'
		});

		expect(result.score).toBe(17);
		expect(db.user.update).toHaveBeenCalledWith({
			where: claimableWhere(hackerUser.uid, adminUser.uid),
			data: {
				score: 17,
				notes: 'Strong project history',
				// Attribution rides in the same statement as the score, for the same
				// reason `decidedBy` does: the CAS above can miss.
				scoredBy: adminUser.uid,
				scoredAt: new Date(),
				claimedBy: null,
				claimedAt: null
			}
		});
	});

	it('sets no decision — scoring and deciding are separate passes', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue(hackerUser as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.admissions.setScore({ uid: hackerUser.uid, score: 12 });

		const callArg = db.user.update.mock.calls[0]?.[0];
		expect(callArg?.data).not.toHaveProperty('pendingDecision');
		expect(callArg?.data).not.toHaveProperty('activeDecision');
	});

	it('stores blank notes as null so a note can be deleted', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue(hackerUser as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.admissions.setScore({ uid: hackerUser.uid, score: 3, notes: '   ' });

		const callArg = db.user.update.mock.calls[0]?.[0];
		expect((callArg?.data as { notes: unknown }).notes).toBeNull();
	});

	it('logs an audit entry naming the score', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue({ ...hackerUser, score: 20 } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.admissions.setScore({ uid: hackerUser.uid, score: 20 });

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.score.set',
					actorId: adminUser.uid,
					targetId: hackerUser.uid,
					metadata: expect.objectContaining({ score: 20, hasNotes: false })
				})
			})
		);
	});

	it('throws CONFLICT naming the holder when another admin has it locked', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(recordNotFound());
		db.user.findUnique.mockResolvedValue({
			name: claimedHacker.name,
			claimer: { name: adminUser2.name }
		} as never);

		await expect(
			caller.admissions.setScore({ uid: claimedHacker.uid, score: 10 })
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message: expect.stringContaining('Second Admin')
		});
	});

	it('throws NOT_FOUND when the applicant does not exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockRejectedValue(recordNotFound());
		db.user.findUnique.mockResolvedValue(null as never);

		await expect(caller.admissions.setScore({ uid: 'ghost-uid', score: 10 })).rejects.toMatchObject(
			{ code: 'NOT_FOUND' }
		);
	});

	it('rejects a score outside the scale, and a fractional one', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(caller.admissions.setScore({ uid: hackerUser.uid, score: 21 })).rejects.toThrow();
		await expect(caller.admissions.setScore({ uid: hackerUser.uid, score: -1 })).rejects.toThrow();
		await expect(
			caller.admissions.setScore({ uid: hackerUser.uid, score: 17.5 })
		).rejects.toThrow();
		expect(db.user.update).not.toHaveBeenCalled();
	});
});

describe('admissions.setDecisions', () => {
	it('applies one decision to many, guarded by claim and role', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 3 } as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.admissions.setDecisions({
			uids: ['a', 'b', 'c'],
			decision: DecisionStatus.ACCEPTED
		});

		expect(result).toEqual({ updated: 3, skipped: 0 });
		expect(db.user.updateMany).toHaveBeenCalledWith({
			where: {
				uid: { in: ['a', 'b', 'c'] },
				role: { in: APPLICANT_ROLES },
				OR: [
					{ claimedBy: null },
					{ claimedBy: adminUser.uid },
					{ claimedAt: { lt: new Date(NOW.getTime() - CLAIM_TTL_MS) } }
				]
			},
			data: {
				pendingDecision: DecisionStatus.ACCEPTED,
				decidedBy: adminUser.uid,
				decidedAt: new Date(),
				claimedBy: null,
				claimedAt: null
			}
		});
	});

	it('reports rows it could not take rather than silently deciding fewer', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.updateMany.mockResolvedValue({ count: 2 } as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.admissions.setDecisions({
			uids: ['a', 'b', 'c'],
			decision: DecisionStatus.REJECTED
		});

		expect(result).toEqual({ updated: 2, skipped: 1 });
		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'admissions.decision.bulk',
					summary: expect.stringContaining('1 skipped'),
					metadata: expect.objectContaining({ updated: 2, skipped: 1 })
				})
			})
		);
	});

	it('refuses PENDING and an empty selection', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(
			// @ts-expect-error PENDING is deliberately not in the input union
			caller.admissions.setDecisions({ uids: ['a'], decision: DecisionStatus.PENDING })
		).rejects.toThrow();
		await expect(
			caller.admissions.setDecisions({ uids: [], decision: DecisionStatus.ACCEPTED })
		).rejects.toThrow();
		expect(db.user.updateMany).not.toHaveBeenCalled();
	});
});

describe('admissions.stats', () => {
	/** groupBy first, then the scored and unscored counts, in that order. */
	function mockStats(
		rows: Array<{
			pendingDecision: DecisionStatus | null;
			activeDecision: DecisionStatus | null;
			count: number;
		}>,
		scored = 0,
		unscored = 0
	) {
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce(
			rows.map((r) => ({
				pendingDecision: r.pendingDecision,
				activeDecision: r.activeDecision,
				_count: { _all: r.count }
			})) as never
		);
		db.user.count.mockResolvedValueOnce(scored as never).mockResolvedValueOnce(unscored as never);
	}

	it('counts a decision at its effective value — pending shadows active', async () => {
		const caller = createTestCaller(db, adminUser);
		mockStats([
			// Released as rejected, then re-decided to accepted and not yet released.
			// The applicant is accepted; counting the released value would say otherwise.
			{
				pendingDecision: DecisionStatus.ACCEPTED,
				activeDecision: DecisionStatus.REJECTED,
				count: 2
			},
			{ pendingDecision: null, activeDecision: DecisionStatus.REJECTED, count: 5 },
			{ pendingDecision: DecisionStatus.WAITLISTED, activeDecision: null, count: 3 }
		]);

		const stats = await caller.admissions.stats();

		expect(stats.accepted).toBe(2);
		expect(stats.rejected).toBe(5);
		expect(stats.waitlisted).toBe(3);
	});

	it('counts rows with no decision — and a leftover PENDING — as undecided', async () => {
		const caller = createTestCaller(db, adminUser);
		mockStats([
			{ pendingDecision: null, activeDecision: null, count: 40 },
			{ pendingDecision: DecisionStatus.PENDING, activeDecision: null, count: 2 }
		]);

		const stats = await caller.admissions.stats();

		expect(stats.undecided).toBe(42);
		expect(stats.accepted).toBe(0);
	});

	it('counts pending separately from the outcome buckets', async () => {
		// `pending` is what Release acts on, and it cuts across accepted/rejected:
		// an accepted applicant is accepted whether or not they have been emailed.
		const caller = createTestCaller(db, adminUser);
		mockStats([
			{ pendingDecision: DecisionStatus.ACCEPTED, activeDecision: null, count: 4 },
			{ pendingDecision: null, activeDecision: DecisionStatus.ACCEPTED, count: 6 }
		]);

		const stats = await caller.admissions.stats();

		expect(stats.accepted).toBe(10);
		expect(stats.pending).toBe(4);
	});

	it('splits the undecided queue into scored and unscored', async () => {
		const caller = createTestCaller(db, adminUser);
		mockStats([{ pendingDecision: null, activeDecision: null, count: 30 }], 12, 18);

		const stats = await caller.admissions.stats();

		expect(stats.scored).toBe(12);
		expect(stats.unscored).toBe(18);
		// The two halves are the same population the groupBy called undecided.
		expect(stats.scored + stats.unscored).toBe(stats.undecided);
	});
});

describe('admissions.list — scoring filters', () => {
	it('narrows to the unscored half of the queue', async () => {
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await createTestCaller(db, adminUser).admissions.list({ noDecision: true, scored: false });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({ score: null });
	});

	it('narrows to the scored half', async () => {
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await createTestCaller(db, adminUser).admissions.list({ scored: true });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({ score: { not: null } });
	});

	it('applies no score filter when the flag is omitted', async () => {
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await createTestCaller(db, adminUser).admissions.list({});

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).not.toContainEqual({ score: null });
		expect(where.AND).not.toContainEqual({ score: { not: null } });
	});

	it('ranks highest first, breaking ties on who applied earliest', async () => {
		// Deterministic ties matter: the ranked list is worked top-down in batches,
		// so two applicants on the same score must not swap places between reloads.
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await createTestCaller(db, adminUser).admissions.list({ scored: true, sort: 'score' });

		expect(db.user.findMany.mock.calls.at(-1)?.[0]?.orderBy).toEqual([
			{ score: { sort: 'desc', nulls: 'last' } },
			{ createdAt: 'asc' }
		]);
	});
});

describe('admissions.reviewerStats', () => {
	/**
	 * Set up the two DB calls the query makes: groupBy for counts, then findMany to
	 * resolve the admin names. The order is fixed — groupBy first, then the name lookup.
	 */
	function mockReviewerStats(
		groups: Array<{ scoredBy: string; count: number; lastScoredAt: Date | null }>,
		admins: Array<{ uid: string; name: string }>
	) {
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce(
			groups.map((g) => ({
				scoredBy: g.scoredBy,
				_count: { _all: g.count },
				_max: { scoredAt: g.lastScoredAt }
			})) as never
		);
		db.user.findMany.mockResolvedValueOnce(admins as never);
	}

	it('returns one row per reviewer, sorted by score count descending', async () => {
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats(
			[
				{ scoredBy: adminUser.uid, count: 5, lastScoredAt: NOW },
				{ scoredBy: adminUser2.uid, count: 12, lastScoredAt: NOW }
			],
			[
				{ uid: adminUser.uid, name: adminUser.name },
				{ uid: adminUser2.uid, name: adminUser2.name }
			]
		);

		const result = await caller.admissions.reviewerStats();

		expect(result).toHaveLength(2);
		// Higher count comes first
		expect(result[0]?.uid).toBe(adminUser2.uid);
		expect(result[0]?.scored).toBe(12);
		expect(result[1]?.uid).toBe(adminUser.uid);
		expect(result[1]?.scored).toBe(5);
	});

	it('resolves admin names from the UID', async () => {
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats(
			[{ scoredBy: adminUser.uid, count: 3, lastScoredAt: NOW }],
			[{ uid: adminUser.uid, name: adminUser.name }]
		);

		const result = await caller.admissions.reviewerStats();

		expect(result[0]?.name).toBe('Admin User');
	});

	it('falls back to "Unknown" when the admin record is missing', async () => {
		// Can happen if an admin account was deleted after they scored applications.
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats([{ scoredBy: 'deleted-uid', count: 2, lastScoredAt: null }], []);

		const result = await caller.admissions.reviewerStats();

		expect(result[0]?.name).toBe('Unknown');
	});

	it('returns an empty array when nobody has scored yet', async () => {
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats([], []);

		const result = await caller.admissions.reviewerStats();

		expect(result).toEqual([]);
	});

	it('queries only rows where scoredBy is not null', async () => {
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats([], []);

		await caller.admissions.reviewerStats();

		expect(mockGroupBy(db.user.groupBy)).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { scoredBy: { not: null } }
			})
		);
	});

	it('passes each reviewer uid to the name lookup', async () => {
		const caller = createTestCaller(db, adminUser);
		mockReviewerStats(
			[
				{ scoredBy: adminUser.uid, count: 1, lastScoredAt: null },
				{ scoredBy: adminUser2.uid, count: 1, lastScoredAt: null }
			],
			[
				{ uid: adminUser.uid, name: adminUser.name },
				{ uid: adminUser2.uid, name: adminUser2.name }
			]
		);

		await caller.admissions.reviewerStats();

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: { in: expect.arrayContaining([adminUser.uid, adminUser2.uid]) } }
			})
		);
	});

	it('includes lastScoredAt from the groupBy max', async () => {
		const caller = createTestCaller(db, adminUser);
		const lastScored = new Date('2024-05-15T10:00:00Z');
		mockReviewerStats(
			[{ scoredBy: adminUser.uid, count: 7, lastScoredAt: lastScored }],
			[{ uid: adminUser.uid, name: adminUser.name }]
		);

		const result = await caller.admissions.reviewerStats();

		expect(result[0]?.lastScoredAt).toEqual(lastScored);
	});

	it('throws FORBIDDEN for non-admins', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.reviewerStats()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('admissions — a literal PENDING is not a decision', () => {
	it('keeps PENDING applicants in the queue rather than filtering them out', async () => {
		// The seed writes PENDING for "in the queue, untouched", and setDecision
		// refuses to write it at all. Matching only on NULL hid those applicants
		// from the very page that exists to review them.
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await createTestCaller(db, adminUser).admissions.list({ noDecision: true });

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [{ pendingDecision: null }, { pendingDecision: DecisionStatus.PENDING }],
			activeDecision: null
		});
	});

	it('falls through to the released decision when the pending one is PENDING', async () => {
		const caller = createTestCaller(db, adminUser);
		mockGroupBy(db.user.groupBy).mockResolvedValueOnce([
			{
				pendingDecision: DecisionStatus.PENDING,
				activeDecision: DecisionStatus.ACCEPTED,
				_count: { _all: 3 }
			}
		] as never);
		db.user.count.mockResolvedValueOnce(0 as never).mockResolvedValueOnce(0 as never);

		const stats = await caller.admissions.stats();

		// Already accepted and told so — PENDING alongside it must not undo that.
		expect(stats.accepted).toBe(3);
		expect(stats.undecided).toBe(0);
		// ...and it is not releasable, because there is no real pending decision.
		expect(stats.pending).toBe(0);
	});
});
