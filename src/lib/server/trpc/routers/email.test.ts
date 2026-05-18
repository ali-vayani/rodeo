import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, appliedHacker } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendEmail } = await import('$lib/server/email');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendEmail).mockClear();
});

const emailInput = {
	subject: 'Hello Hackers',
	body: 'Welcome to the hackathon!',
	filters: {}
};

const emailLog = {
	id: 'elog-1',
	template: null,
	subject: emailInput.subject,
	body: emailInput.body,
	userIds: [hackerUser.uid],
	sentAt: new Date()
};

describe('email.sendCustom', () => {
	it('sends email to each matching user and creates log', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, appliedHacker] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		const result = await caller.email.sendCustom(emailInput);

		expect(result).toEqual({ sent: 2 });
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ subject: emailInput.subject, body: emailInput.body })
			})
		);
	});

	it('filters users by role', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			...emailInput,
			filters: { roles: [Role.HACKER] }
		});

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ roles: { hasSome: [Role.HACKER] } })
			})
		);
	});

	it('filters users by status', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([appliedHacker] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			...emailInput,
			filters: { statuses: [UserStatus.APPLIED] }
		});

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ status: { in: [UserStatus.APPLIED] } })
			})
		);
	});

	it('returns sent=0 when no users match filters', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		const result = await caller.email.sendCustom(emailInput);

		expect(result).toEqual({ sent: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(db.emailLog.create).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.email.sendCustom(emailInput)).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('email.getLogs', () => {
	it('returns paginated logs', async () => {
		const caller = createTestCaller(db, adminUser);
		db.emailLog.count.mockResolvedValue(1);
		db.emailLog.findMany.mockResolvedValue([emailLog] as never);

		const result = await caller.email.getLogs({ page: 1, pageSize: 20 });

		expect(result.logs).toEqual([emailLog]);
		expect(result.total).toBe(1);
		expect(result.page).toBe(1);
	});

	it('applies correct pagination offset', async () => {
		const caller = createTestCaller(db, adminUser);
		db.emailLog.count.mockResolvedValue(50);
		db.emailLog.findMany.mockResolvedValue([]);

		await caller.email.getLogs({ page: 3, pageSize: 10 });

		expect(db.emailLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 20, take: 10 })
		);
	});
});
