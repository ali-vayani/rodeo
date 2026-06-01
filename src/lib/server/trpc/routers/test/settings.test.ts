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

describe('settings.get', () => {
	it('returns settings when row exists', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		const result = await caller.settings.get();
		expect(result).toEqual(mockSettings);
	});

	it('returns DEFAULT_SETTINGS when no row exists', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(null);
		const result = await caller.settings.get();
		expect(result).toMatchObject({
			scanActions: ['Check-In'],
			timezone: 'America/Chicago'
		});
	});

	it('throws UNAUTHORIZED when not logged in', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.settings.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});
});

describe('settings.update', () => {
	it('updates existing row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.settings.update.mockResolvedValue({ ...mockSettings, timezone: 'America/New_York' });

		const result = await caller.settings.update({ ...mockSettings, timezone: 'America/New_York' });

		expect(db.settings.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: mockSettings.id } })
		);
		expect(result.timezone).toBe('America/New_York');
	});

	it('creates row when none exists', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);
		db.settings.create.mockResolvedValue(mockSettings);

		await caller.settings.update(mockSettings);

		expect(db.settings.create).toHaveBeenCalled();
		expect(db.settings.update).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.settings.update(mockSettings)).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});
