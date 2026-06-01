import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { BlacklistType } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const entry = {
	id: 'bl-1',
	type: BlacklistType.EMAIL,
	value: 'bad@example.com',
	createdAt: new Date('2024-01-01')
};

describe('blacklist.list', () => {
	it('returns all entries for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.findMany.mockResolvedValue([entry]);
		const result = await caller.blacklist.list();
		expect(result).toEqual([entry]);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.blacklist.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('blacklist.add', () => {
	it('creates one entry', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.create.mockResolvedValue(entry);
		const result = await caller.blacklist.add({ type: BlacklistType.EMAIL, value: 'bad@example.com' });
		expect(result).toEqual(entry);
		expect(db.blacklist.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: { type: BlacklistType.EMAIL, value: 'bad@example.com' } })
		);
	});
});

describe('blacklist.addBulk', () => {
	it('creates many entries with skipDuplicates', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.createMany.mockResolvedValue({ count: 2 });
		const entries = [
			{ type: BlacklistType.EMAIL, value: 'a@example.com' },
			{ type: BlacklistType.NAME, value: 'spammer' }
		];
		const result = await caller.blacklist.addBulk(entries);
		expect(result).toEqual({ count: 2 });
		expect(db.blacklist.createMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: entries, skipDuplicates: true })
		);
	});
});

describe('blacklist.remove', () => {
	it('deletes by id', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.delete.mockResolvedValue(entry);
		const result = await caller.blacklist.remove({ id: 'bl-1' });
		expect(result).toEqual(entry);
		expect(db.blacklist.delete).toHaveBeenCalledWith({ where: { id: 'bl-1' } });
	});
});
