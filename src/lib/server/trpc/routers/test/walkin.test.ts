import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient, User } from '$lib/generated/prisma/client';
import { DecisionStatus, UserStatus } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser, mockSettings } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendEmail: vi.fn().mockResolvedValue(undefined),
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

/** An invited hacker with a submitted application — the one-click confirm case. */
const invitedApplicant: User = {
	...hackerUser,
	status: UserStatus.APPLIED,
	walkInInvitedAt: new Date('2026-10-12T15:00:00Z')
};

describe('walkin.invite', () => {
	it('refuses a blacklisted email before touching the user row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.blacklist.findUnique.mockResolvedValue({ id: 'bl-1' } as never);

		await expect(caller.walkin.invite({ email: 'banned@example.com' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
		expect(db.user.upsert).not.toHaveBeenCalled();
	});
});

describe('walkin.confirm', () => {
	it('refuses a blacklisted invitee, and writes nothing', async () => {
		// The invite-time check is not enough: a block added after the invite went out
		// must still hold at the moment the spot would be granted.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(invitedApplicant);
		db.blacklist.findUnique.mockResolvedValue({ id: 'bl-1' } as never);

		await expect(caller.walkin.confirm()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(db.user.updateMany).not.toHaveBeenCalled();
	});

	it('confirms a clean invitee: CONFIRMED, isWalkIn, both decisions ACCEPTED', async () => {
		const caller = createTestCaller(db, hackerUser);
		const confirmed: User = {
			...invitedApplicant,
			status: UserStatus.CONFIRMED,
			isWalkIn: true,
			pendingDecision: DecisionStatus.ACCEPTED,
			activeDecision: DecisionStatus.ACCEPTED
		};
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(invitedApplicant)
			.mockResolvedValueOnce(confirmed);
		db.blacklist.findUnique.mockResolvedValue(null);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.templateOverride.findMany.mockResolvedValue([]);
		db.user.updateMany.mockResolvedValue({ count: 1 });

		const result = await caller.walkin.confirm();

		expect(db.user.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: {
					status: UserStatus.CONFIRMED,
					isWalkIn: true,
					pendingDecision: DecisionStatus.ACCEPTED,
					activeDecision: DecisionStatus.ACCEPTED
				}
			})
		);
		expect(result.status).toBe(UserStatus.CONFIRMED);
		// SELF_USER_SELECT shape only — the full row carries pendingDecision and the
		// claim columns, which must not reach the hacker.
		expect(result).not.toHaveProperty('pendingDecision');
	});

	it('refuses an account that was never invited', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser);

		await expect(caller.walkin.confirm()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('walkin.uninvite', () => {
	it('clears the invite stamp and nothing else', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUnique.mockResolvedValue(invitedApplicant);
		db.user.update.mockResolvedValue({ ...invitedApplicant, walkInInvitedAt: null });

		await caller.walkin.uninvite({ uid: invitedApplicant.uid });

		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: invitedApplicant.uid },
			data: { walkInInvitedAt: null }
		});
	});

	it('refuses someone already checked in', async () => {
		// They are physically present; removing the row would only hide them.
		const caller = createTestCaller(db, adminUser);
		db.user.findUnique.mockResolvedValue({
			...invitedApplicant,
			status: UserStatus.CHECKED_IN
		});

		await expect(caller.walkin.uninvite({ uid: invitedApplicant.uid })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('404s on an account with no invite', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findUnique.mockResolvedValue(hackerUser);

		await expect(caller.walkin.uninvite({ uid: hackerUser.uid })).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
	});
});
