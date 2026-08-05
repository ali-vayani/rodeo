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
	firstName: 'Bad',
	lastName: 'Actor',
	email: 'bad@example.com',
	reason: 'spam',
	createdAt: new Date('2024-01-01')
};

describe('blacklist.list', () => {
	it('returns all entries for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.findMany.mockResolvedValue([entry]);
		expect(await caller.blacklist.list()).toEqual([entry]);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.blacklist.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('blacklist.add', () => {
	it('upserts on the normalized email so re-adding corrects the entry', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.upsert.mockResolvedValue(entry);

		await caller.blacklist.add({
			firstName: 'Bad',
			lastName: 'Actor',
			email: '  BAD@Example.COM ',
			reason: 'spam'
		});

		expect(db.blacklist.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { email: 'bad@example.com' },
				create: expect.objectContaining({ email: 'bad@example.com' }),
				update: { firstName: 'Bad', lastName: 'Actor', reason: 'spam' }
			})
		);
	});

	it('creates rather than upserts when there is no email to key on', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.create.mockResolvedValue({ ...entry, email: null });

		await caller.blacklist.add({ firstName: 'Bad', lastName: 'Actor' });

		expect(db.blacklist.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ email: undefined }) })
		);
		expect(db.blacklist.upsert).not.toHaveBeenCalled();
	});

	it('rejects a malformed email', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(
			caller.blacklist.add({ firstName: 'Bad', lastName: 'Actor', email: 'not-an-email' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('requires both name parts', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(
			caller.blacklist.add({ firstName: 'Bad', lastName: '  ', email: 'bad@example.com' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.blacklist.add({ firstName: 'Bad', lastName: 'Actor' })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('blacklist.addBulk', () => {
	beforeEach(() => {
		db.blacklist.findMany.mockResolvedValue([]);
	});

	it('normalizes emails and inserts valid rows', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.createMany.mockResolvedValue({ count: 2 });

		const result = await caller.blacklist.addBulk({
			rows: [
				{ firstName: 'Spammer', lastName: 'One', email: 'A@Example.com' },
				{ firstName: 'Spammer', lastName: 'Two', email: 'B@Example.com', reason: 'fraud' }
			]
		});

		expect(result).toEqual({ added: 2, duplicates: 0, invalid: [] });
		expect(db.blacklist.createMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: [
					{ firstName: 'Spammer', lastName: 'One', email: 'a@example.com', reason: undefined },
					{ firstName: 'Spammer', lastName: 'Two', email: 'b@example.com', reason: 'fraud' }
				],
				skipDuplicates: true
			})
		);
	});

	it('imports the valid rows and reports the invalid ones by position', async () => {
		// One bad address must not cost the admin the rest of the file.
		const caller = createTestCaller(db, adminUser);
		db.blacklist.createMany.mockResolvedValue({ count: 2 });

		const result = await caller.blacklist.addBulk({
			rows: [
				{ firstName: 'Good', lastName: 'One', email: 'good@example.com' },
				{ firstName: 'Bad', lastName: 'Row', email: 'not-an-email' },
				{ firstName: '', lastName: 'NoFirst' },
				{ firstName: 'Good', lastName: 'Two' }
			]
		});

		expect(result.added).toBe(2);
		expect(result.invalid).toEqual([
			{ row: 2, reason: 'Invalid email address' },
			{ row: 3, reason: 'First name is required' }
		]);
	});

	it('reports rows the database skipped as duplicates, not as successes', async () => {
		const caller = createTestCaller(db, adminUser);
		// Two valid rows sent, one already present, so only one lands.
		db.blacklist.createMany.mockResolvedValue({ count: 1 });

		const result = await caller.blacklist.addBulk({
			rows: [
				{ firstName: 'A', lastName: 'One', email: 'a@example.com' },
				{ firstName: 'B', lastName: 'Two', email: 'b@example.com' }
			]
		});

		expect(result).toEqual({ added: 1, duplicates: 1, invalid: [] });
	});

	it('drops name-only rows already in the table, which no unique index covers', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.findMany.mockResolvedValue([
			{ firstName: 'John', lastName: 'Doe' }
		] as unknown as never);
		db.blacklist.createMany.mockResolvedValue({ count: 1 });

		await caller.blacklist.addBulk({
			rows: [
				{ firstName: 'john', lastName: 'DOE' },
				{ firstName: 'Jane', lastName: 'Roe' }
			]
		});

		expect(db.blacklist.createMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: [{ firstName: 'Jane', lastName: 'Roe', email: undefined, reason: undefined }]
			})
		);
	});

	it('deduplicates name-only rows repeated within one file', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.createMany.mockResolvedValue({ count: 1 });

		await caller.blacklist.addBulk({
			rows: [
				{ firstName: 'John', lastName: 'Doe' },
				{ firstName: 'John', lastName: 'Doe' }
			]
		});

		expect(db.blacklist.createMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: [expect.objectContaining({ firstName: 'John' })] })
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.blacklist.addBulk({ rows: [] })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('blacklist.remove', () => {
	it('deletes by id', async () => {
		const caller = createTestCaller(db, adminUser);
		db.blacklist.delete.mockResolvedValue(entry);
		expect(await caller.blacklist.remove({ id: 'bl-1' })).toEqual(entry);
		expect(db.blacklist.delete).toHaveBeenCalledWith({ where: { id: 'bl-1' } });
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.blacklist.remove({ id: 'bl-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});
