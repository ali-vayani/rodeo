import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockSettings } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendTemplatedEmail } = await import('$lib/server/email');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendTemplatedEmail).mockClear();
});

const pendingUser = {
	...hackerUser,
	uid: 'pending-uid',
	email: 'pending@example.com',
	pendingDecision: DecisionStatus.ACCEPTED
};

describe('admissions.list', () => {
	it('returns all users with no filters', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, pendingUser] as never);
		const result = await caller.admissions.list({});
		expect(result).toHaveLength(2);
	});

	it('filters by roles', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		await caller.admissions.list({ roles: [Role.HACKER] });
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ roles: { hasSome: [Role.HACKER] } })
			})
		);
	});

	it('filters by decision', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		await caller.admissions.list({ decision: DecisionStatus.ACCEPTED });
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					OR: [
						{ pendingDecision: DecisionStatus.ACCEPTED },
						{ activeDecision: DecisionStatus.ACCEPTED }
					]
				})
			})
		);
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.admissions.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('admissions.setDecision', () => {
	it('sets pendingDecision only', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue({ ...hackerUser, pendingDecision: DecisionStatus.ACCEPTED } as never);

		const result = await caller.admissions.setDecision({
			uid: hackerUser.uid,
			decision: DecisionStatus.ACCEPTED
		});

		expect(result.pendingDecision).toBe(DecisionStatus.ACCEPTED);
		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid },
			data: { pendingDecision: DecisionStatus.ACCEPTED }
		});
	});

	it('does NOT touch activeDecision', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.update.mockResolvedValue(hackerUser as never);

		await caller.admissions.setDecision({ uid: hackerUser.uid, decision: DecisionStatus.REJECTED });

		const callArg = db.user.update.mock.calls[0]?.[0];
		expect(callArg?.data).not.toHaveProperty('activeDecision');
	});
});

describe('admissions.release', () => {
	it('copies pending→active for all matched users', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([]);

		const result = await caller.admissions.release({});
		expect(result).toEqual({ released: 1 });
		expect(db.$transaction).toHaveBeenCalled();
		// user.update should be called once (inside the map)
		expect(db.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { activeDecision: pendingUser.pendingDecision, pendingDecision: null }
			})
		);
	});

	it('creates log entry after release', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([]);

		await caller.admissions.release({});

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: expect.stringContaining('Released decisions') })
			})
		);
	});

	it('calls email for each decision type when settings exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([pendingUser] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.log.create.mockResolvedValue({} as never);
		db.$transaction.mockResolvedValue([]);

		await caller.admissions.release({});

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			pendingUser.email,
			mockSettings.acceptTemplate,
			expect.objectContaining({ name: pendingUser.name })
		);
	});

	it('throws BAD_REQUEST when no pending decisions exist', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		await expect(caller.admissions.release({})).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});
});
