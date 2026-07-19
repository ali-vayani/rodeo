import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { ScheduleType } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

const event = {
	id: 'sched-1',
	name: 'Opening Ceremony',
	description: 'Welcome!',
	start: new Date('2024-04-15T09:00:00Z'),
	end: new Date('2024-04-15T10:00:00Z'),
	location: 'Main Hall',
	type: ScheduleType.CEREMONY
};

const eventInput = {
	name: 'Opening Ceremony',
	description: 'Welcome!',
	start: new Date('2024-04-15T09:00:00Z'),
	end: new Date('2024-04-15T10:00:00Z'),
	location: 'Main Hall',
	type: ScheduleType.CEREMONY
};

describe('schedule.list', () => {
	it('returns events sorted by start time (public)', async () => {
		const caller = createTestCaller(db, null);
		db.schedule.findMany.mockResolvedValue([event]);
		const result = await caller.schedule.list();
		expect(result).toEqual([event]);
		expect(db.schedule.findMany).toHaveBeenCalledWith({ orderBy: { start: 'asc' } });
	});
});

describe('schedule.create', () => {
	it('creates event for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.schedule.create.mockResolvedValue(event);
		const result = await caller.schedule.create(eventInput);
		expect(result).toEqual(event);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.schedule.create(eventInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('schedule.update', () => {
	it('updates event for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.schedule.update.mockResolvedValue(event);
		const result = await caller.schedule.update({ id: 'sched-1', ...eventInput });
		expect(result).toEqual(event);
		expect(db.schedule.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'sched-1' } })
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.schedule.update({ id: 'sched-1', ...eventInput })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('schedule.delete', () => {
	it('deletes event for admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.schedule.delete.mockResolvedValue(event);
		const result = await caller.schedule.delete({ id: 'sched-1' });
		expect(result).toEqual(event);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.schedule.delete({ id: 'sched-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});
