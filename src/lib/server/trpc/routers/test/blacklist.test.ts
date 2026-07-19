import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
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
	name: 'Bad Actor',
	email: 'bad@example.com',
	reason: 'spam',
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
	it('upserts one entry by normalized email', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.upsert.mockResolvedValue(entry);
		const result = await caller.blacklist.add({
			name: 'Bad Actor',
			email: 'bad@example.com',
			reason: 'spam'
		});
		expect(result).toEqual(entry);
		expect(db.blacklist.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { email: 'bad@example.com' },
				create: { name: 'Bad Actor', email: 'bad@example.com', reason: 'spam' },
				update: { name: 'Bad Actor', reason: 'spam' }
			})
		);
	});

	it('normalizes email (lowercase) before upserting', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.upsert.mockResolvedValue(entry);
		await caller.blacklist.add({ name: 'Bad Actor', email: 'BAD@Example.COM', reason: 'spam' });
		expect(db.blacklist.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { email: 'bad@example.com' },
				create: expect.objectContaining({ email: 'bad@example.com' })
			})
		);
	});

	it('upserts entry without reason', async () => {
		const caller = createTestCaller(db, adminUser);
		const noReason = { ...entry, reason: null };
		db.blacklist.upsert.mockResolvedValue(noReason);
		const result = await caller.blacklist.add({ name: 'Bad Actor', email: 'bad@example.com' });
		expect(result).toEqual(noReason);
	});
});

describe('blacklist.addBulk', () => {
	it('creates many entries with normalized emails, skipping duplicates', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.createMany.mockResolvedValue({ count: 2 });
		const result = await caller.blacklist.addBulk([
			{ name: 'Spammer One', email: 'A@Example.com' },
			{ name: 'Spammer Two', email: 'B@Example.com', reason: 'fraud' }
		]);
		expect(result).toEqual({ count: 2 });
		expect(db.blacklist.createMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: [
					{ name: 'Spammer One', email: 'a@example.com' },
					{ name: 'Spammer Two', email: 'b@example.com', reason: 'fraud' }
				],
				skipDuplicates: true
			})
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
