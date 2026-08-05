import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	adminUser,
	hackerUser,
	confirmedHacker,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const mockScan = {
	id: 'scan-1',
	action: 'Check-In',
	timestamp: new Date(),
	userId: hackerUser.uid,
	user: hackerUser
};

describe('scan.scanUser', () => {
	it('creates scan and returns user on success', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(hackerUser as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.create.mockResolvedValue(mockScan as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.scan.scanUser({ userCode: hackerUser.uid, action: 'Check-In' });

		expect(result.user).toMatchObject({ uid: hackerUser.uid });
		expect(result.isDuplicate).toBe(false);
	});

	it('sets isDuplicate=true when already scanned today', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(hackerUser as never);
		db.scan.findFirst.mockResolvedValue(mockScan as never); // duplicate found
		db.scan.create.mockResolvedValue(mockScan as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.scan.scanUser({ userCode: hackerUser.uid, action: 'Check-In' });

		expect(result.isDuplicate).toBe(true);
	});

	it('throws NOT_FOUND for unknown user code', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(null);

		await expect(
			caller.scan.scanUser({ userCode: 'RC-UNKNOWN', action: 'Check-In' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('throws BAD_REQUEST for invalid action not in settings', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings); // only has 'Check-In'

		await expect(
			caller.scan.scanUser({ userCode: hackerUser.uid, action: 'Lunch' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('allows any action when settings is null', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null); // no settings = skip validation
		db.user.findFirst.mockResolvedValue(hackerUser as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.create.mockResolvedValue(mockScan as never);
		db.log.create.mockResolvedValue({} as never);

		const result = await caller.scan.scanUser({ userCode: hackerUser.uid, action: 'Lunch' });
		expect(result.isDuplicate).toBe(false);
	});

	it('creates a log entry', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(hackerUser as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.create.mockResolvedValue(mockScan as never);
		db.log.create.mockResolvedValue({} as never);

		await caller.scan.scanUser({ userCode: hackerUser.uid, action: 'Check-In' });

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: expect.stringContaining(hackerUser.name)
				})
			})
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.scan.scanUser({ userCode: 'RC-ABC', action: 'Check-In' })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('scan.lookup', () => {
	it('returns user, isDuplicate=false, warning=null for a normal confirmed hacker', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(confirmedHacker as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(2);

		const result = await caller.scan.lookup({ userCode: confirmedHacker.uid, action: 'Check-In' });

		expect(result.user).toMatchObject({ uid: confirmedHacker.uid });
		expect(result.isDuplicate).toBe(false);
		expect(result.scanCountForAction).toBe(2);
		expect(result.warning).toBeNull();
	});

	it('throws NOT_FOUND for unknown user code', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(null);

		await expect(
			caller.scan.lookup({ userCode: 'RC-UNKNOWN', action: 'Check-In' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('throws BAD_REQUEST for invalid action not in settings', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await expect(
			caller.scan.lookup({ userCode: hackerUser.uid, action: 'Lunch' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('sets isDuplicate=true without creating a scan row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(confirmedHacker as never);
		db.scan.findFirst.mockResolvedValue(mockScan as never);
		db.scan.count.mockResolvedValue(1);

		const result = await caller.scan.lookup({ userCode: confirmedHacker.uid, action: 'Check-In' });

		expect(result.isDuplicate).toBe(true);
		expect(db.scan.create).not.toHaveBeenCalled();
	});

	it('sets warning=UNCONFIRMED_HACKER for a hacker who has not confirmed', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(hackerUser as never); // status CREATED
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(0);

		const result = await caller.scan.lookup({ userCode: hackerUser.uid, action: 'Check-In' });

		expect(result.warning).toBe('UNCONFIRMED_HACKER');
	});

	it('does not warn for a CHECKED_IN hacker', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue({ ...hackerUser, status: 'CHECKED_IN' } as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(1);

		const result = await caller.scan.lookup({ userCode: hackerUser.uid, action: 'Check-In' });

		expect(result.warning).toBeNull();
	});

	it('does not warn for non-hacker roles regardless of status', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findFirst.mockResolvedValue(adminUser as never); // ADMIN role, status CREATED

		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(0);

		const result = await caller.scan.lookup({ userCode: adminUser.uid, action: 'Check-In' });

		expect(result.warning).toBeNull();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);

		await expect(caller.scan.lookup({ userCode: 'x', action: 'Check-In' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('scan.lookupByEmail', () => {
	it('returns user, isDuplicate=false, warning=null for a normal confirmed hacker', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(2);

		const result = await caller.scan.lookupByEmail({
			email: confirmedHacker.email,
			action: 'Check-In'
		});

		expect(result.user).toMatchObject({ uid: confirmedHacker.uid });
		expect(result.isDuplicate).toBe(false);
		expect(result.scanCountForAction).toBe(2);
		expect(result.warning).toBeNull();
	});

	it('normalizes email casing/whitespace before lookup', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never);
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(0);

		await caller.scan.lookupByEmail({
			email: `  ${confirmedHacker.email.toUpperCase()}  `,
			action: 'Check-In'
		});

		expect(db.user.findUnique).toHaveBeenCalledWith({
			where: { email: confirmedHacker.email }
		});
	});

	it('throws NOT_FOUND for unknown email', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findUnique.mockResolvedValue(null);

		await expect(
			caller.scan.lookupByEmail({ email: 'nobody@example.com', action: 'Check-In' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('throws BAD_REQUEST for invalid action not in settings', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await expect(
			caller.scan.lookupByEmail({ email: hackerUser.email, action: 'Lunch' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('sets isDuplicate=true without creating a scan row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never);
		db.scan.findFirst.mockResolvedValue(mockScan as never);
		db.scan.count.mockResolvedValue(1);

		const result = await caller.scan.lookupByEmail({
			email: confirmedHacker.email,
			action: 'Check-In'
		});

		expect(result.isDuplicate).toBe(true);
		expect(db.scan.create).not.toHaveBeenCalled();
	});

	it('sets warning=UNCONFIRMED_HACKER for a hacker who has not confirmed', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.user.findUnique.mockResolvedValue(hackerUser as never); // status CREATED
		db.scan.findFirst.mockResolvedValue(null);
		db.scan.count.mockResolvedValue(0);

		const result = await caller.scan.lookupByEmail({
			email: hackerUser.email,
			action: 'Check-In'
		});

		expect(result.warning).toBe('UNCONFIRMED_HACKER');
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);

		await expect(
			caller.scan.lookupByEmail({ email: hackerUser.email, action: 'Check-In' })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('scan.getCounts', () => {
	it('zero-fills configured actions with no scans', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue({
			...mockSettings,
			scanActions: ['Check-In', 'Lunch']
		});
		db.scan.groupBy.mockResolvedValue([{ action: 'Check-In', _count: { action: 5 } }] as never);

		const result = await caller.scan.getCounts();

		expect(result).toEqual({ 'Check-In': 5, Lunch: 0 });
	});

	it('includes historical actions no longer in settings.scanActions', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings); // only 'Check-In'
		db.scan.groupBy.mockResolvedValue([
			{ action: 'Check-In', _count: { action: 3 } },
			{ action: 'Retired Action', _count: { action: 2 } }
		] as never);

		const result = await caller.scan.getCounts();

		expect(result).toEqual({ 'Check-In': 3, 'Retired Action': 2 });
	});

	it('falls back to default action list when settings is null', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);
		db.scan.groupBy.mockResolvedValue([]);

		const result = await caller.scan.getCounts();

		expect(result).toEqual({ 'Check-In': 0 });
	});
});

describe('scan.getRecent', () => {
	it('returns last N scans with user info', async () => {
		const caller = createTestCaller(db, adminUser);
		db.scan.findMany.mockResolvedValue([mockScan] as never);

		const result = await caller.scan.getRecent({ limit: 5 });
		expect(result).toHaveLength(1);
		expect(db.scan.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 5, include: { user: true } })
		);
	});
});

describe('scan.getHistory', () => {
	it('returns scans for a specific userId', async () => {
		const caller = createTestCaller(db, adminUser);
		db.scan.findMany.mockResolvedValue([mockScan] as never);

		const result = await caller.scan.getHistory({ userId: hackerUser.uid });
		expect(result).toHaveLength(1);
		expect(db.scan.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { userId: hackerUser.uid } })
		);
	});
});
