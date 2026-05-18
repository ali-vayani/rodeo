import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockSettings } from '../test-utils';

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
