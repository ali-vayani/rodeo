import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, appliedHacker } from '../test-utils';

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
		db.user.count.mockResolvedValue(1);
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

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.getById({ uid: 'some-uid' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('user.updateRole', () => {
	it('updates roles array', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue({ ...hackerUser, roles: [Role.ADMIN] } as never);

		const result = await caller.user.updateRole({ uid: hackerUser.uid, roles: [Role.ADMIN] });
		expect(result.roles).toContain(Role.ADMIN);
		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid },
			data: { roles: [Role.ADMIN] }
		});
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.user.updateRole({ uid: 'uid', roles: [Role.HACKER] })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('user.updateStatus', () => {
	it('updates status', async () => {
		const caller = createTestCaller(db, adminUser);
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
			'uid,name,email,roles,status,pendingDecision,activeDecision,teamId,createdAt'
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

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.user.exportCsv()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
