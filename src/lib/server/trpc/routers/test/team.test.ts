import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { InvitationStatus } from '$lib/generated/prisma/client';
import { createTestCaller, hackerUser, confirmedHacker } from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

/**
 * Makes the mocked `$transaction` run its callback against the same client.
 *
 * The deep mock resolves it without invoking anything, which would leave the
 * re-count inside the transaction — the whole point of the atomic join path —
 * unexercised. Writes inside the transaction are then asserted on `db` exactly
 * like writes outside one.
 */
function runTransactions() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- $transaction's overloads can't be spelled at a mock call site.
	db.$transaction.mockImplementation(((fn: any) => fn(db)) as never);
}

/** What Prisma throws when Postgres rolls a serializable transaction back. */
const writeConflict = Object.assign(new Error('write conflict'), { code: 'P2034' });

const mockTeam = {
	id: 'team-1',
	teamName: 'Team Rocket',
	members: [hackerUser],
	invitations: []
};

const mockInvitation = {
	id: 'inv-1',
	teamId: 'team-1',
	email: confirmedHacker.email,
	userId: confirmedHacker.uid,
	status: InvitationStatus.PENDING,
	team: { ...mockTeam, members: [hackerUser] }
};

describe('team.getMyTeam', () => {
	it('returns team and pending invitations', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			team: mockTeam,
			invitations: []
		} as never);

		const result = await caller.team.getMyTeam();
		expect(result.team).toMatchObject({ teamName: 'Team Rocket' });
		expect(result.pendingInvitations).toEqual([]);
	});
});

describe('team.createTeam', () => {
	it('creates team with current user as member', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, teamId: null } as never);
		db.team.create.mockResolvedValue({ ...mockTeam } as never);

		const result = await caller.team.createTeam({ teamName: 'Team Rocket' });
		expect(result.teamName).toBe('Team Rocket');
		expect(db.team.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					teamName: 'Team Rocket',
					members: { connect: { uid: hackerUser.uid } }
				})
			})
		);
	});

	it('throws BAD_REQUEST if user is already on a team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			teamId: 'existing-team'
		} as never);

		await expect(caller.team.createTeam({ teamName: 'New Team' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on a team')
		});
	});
});

describe('team.inviteMember', () => {
	it('creates invitation on success', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never);
		db.invitation.findFirst.mockResolvedValue(null);
		db.invitation.create.mockResolvedValue(mockInvitation as never);

		const result = await caller.team.inviteMember({ email: confirmedHacker.email });
		expect(result).toMatchObject({ teamId: 'team-1', email: confirmedHacker.email });
	});

	it('lowercases and trims the address before looking it up or storing it', async () => {
		// Regression guard: accounts are stored lowercased, so an invite typed with
		// capitals used to report "User not found." for an account that exists.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never);
		db.invitation.findFirst.mockResolvedValue(null);
		db.invitation.create.mockResolvedValue(mockInvitation as never);

		await caller.team.inviteMember({ email: '  Confirmed@Example.COM  ' });

		expect(db.user.findUnique).toHaveBeenCalledWith({
			where: { email: confirmedHacker.email }
		});
		expect(db.invitation.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ email: confirmedHacker.email })
			})
		);
		expect(db.invitation.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ email: confirmedHacker.email })
			})
		);
	});

	it('throws NOT_FOUND if invitee does not exist', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue(null);

		await expect(caller.team.inviteMember({ email: 'ghost@example.com' })).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
	});

	it('throws BAD_REQUEST if invitee is not ACCEPTED', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		// hackerUser has activeDecision: null (not ACCEPTED)
		db.user.findUnique.mockResolvedValue({ ...hackerUser, activeDecision: null } as never);

		await expect(caller.team.inviteMember({ email: hackerUser.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('confirmed')
		});
	});

	it('throws BAD_REQUEST if invitee is already on a team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue({
			...confirmedHacker,
			teamId: 'other-team'
		} as never);

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on a team')
		});
	});

	it('throws BAD_REQUEST if team is full', async () => {
		const caller = createTestCaller(db, hackerUser);
		const fullTeam = {
			...mockTeam,
			members: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }, { uid: 'u4' }]
		};
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: fullTeam } as never);

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});

	it('throws BAD_REQUEST if invite already pending', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue({ ...confirmedHacker, teamId: null } as never);
		db.invitation.findFirst.mockResolvedValue(mockInvitation as never); // existing pending

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already sent')
		});
	});
});

describe('team.acceptInvite', () => {
	it('updates teamId and marks invitation ACCEPTED', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid // belongs to this user
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);

		const result = await caller.team.acceptInvite({ invitationId: 'inv-1' });
		expect(result).toEqual({ success: true });
		expect(db.invitation.update).toHaveBeenCalledWith({
			where: { id: 'inv-1' },
			data: { status: InvitationStatus.ACCEPTED }
		});
		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid },
			data: { teamId: 'team-1' }
		});
	});

	it('counts and writes inside one serializable transaction', async () => {
		// The isolation level is the fix, not decoration: at anything weaker the
		// re-count below can't see a concurrent join and the team over-fills.
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);

		await caller.team.acceptInvite({ invitationId: 'inv-1' });

		expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: 'Serializable'
		});
		expect(db.user.count).toHaveBeenCalledWith({ where: { teamId: 'team-1' } });
	});

	it('refuses when the team filled up between the check and the write', async () => {
		// The read at the top of the mutation saw one member; by the time the
		// transaction opens, three other invitees have accepted. Nobody may write a
		// fifth member, and the loser has to be told.
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(4);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
		expect(db.user.update).not.toHaveBeenCalled();
		expect(db.invitation.update).not.toHaveBeenCalled();
	});

	it('reports a rolled-back transaction as a full team, not a 500', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		db.$transaction.mockRejectedValue(writeConflict);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});

	it('lets an unrelated database failure through', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		db.$transaction.mockRejectedValue(new Error('connection lost'));

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toThrow(
			'connection lost'
		);
	});

	it('throws FORBIDDEN if invitation is for another user', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: 'other-user-uid'
		} as never);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('throws BAD_REQUEST if invitation is not pending', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid,
			status: InvitationStatus.ACCEPTED
		} as never);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
	});

	it('throws BAD_REQUEST if team is already full', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid,
			status: InvitationStatus.PENDING,
			team: { ...mockTeam, members: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }, { uid: 'u4' }] }
		} as never);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});
});

describe('team.declineInvite', () => {
	it('sets invitation to DECLINED', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		db.invitation.update.mockResolvedValue({
			...mockInvitation,
			status: InvitationStatus.DECLINED
		} as never);

		const result = await caller.team.declineInvite({ invitationId: 'inv-1' });
		expect(result.status).toBe(InvitationStatus.DECLINED);
	});

	it('throws FORBIDDEN if invitation is for another user', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: 'other-user-uid'
		} as never);

		await expect(caller.team.declineInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('team.joinByCode', () => {
	it('adds the user to the team behind the code', async () => {
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({ ...mockTeam, members: [hackerUser] } as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);
		db.user.update.mockResolvedValue({ ...confirmedHacker, teamId: 'team-1' } as never);

		const result = await caller.team.joinByCode({ inviteCode: 'code-1' });

		expect(result).toMatchObject({ teamId: 'team-1' });
		expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: 'Serializable'
		});
	});

	it('refuses when the team filled up between the check and the write', async () => {
		// A shared invite link is the easiest way to hit this: four people open the
		// same URL, all four see room, and only the count inside the transaction
		// stops the team reaching eight.
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({ ...mockTeam, members: [hackerUser] } as never);
		runTransactions();
		db.user.count.mockResolvedValue(4);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('reports a rolled-back transaction as a full team, not a 500', async () => {
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({ ...mockTeam, members: [hackerUser] } as never);
		db.$transaction.mockRejectedValue(writeConflict);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});

	it('throws BAD_REQUEST when the team was already full', async () => {
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({
			...mockTeam,
			members: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }, { uid: 'u4' }]
		} as never);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it('throws NOT_FOUND for an unknown code', async () => {
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue(null);

		await expect(caller.team.joinByCode({ inviteCode: 'nope' })).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
	});

	it('throws BAD_REQUEST if the user is already on a team', async () => {
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...confirmedHacker,
			teamId: 'other-team'
		} as never);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on a team')
		});
	});

	it('throws BAD_REQUEST if the user is not confirmed', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('confirmed')
		});
	});
});

describe('team.leaveTeam', () => {
	it('removes user from team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			team: { ...mockTeam, members: [hackerUser, { uid: 'u2' }] }
		} as never);
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);

		const result = await caller.team.leaveTeam();
		expect(result).toEqual({ success: true });
		expect(db.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: hackerUser.uid },
				data: { teamId: null }
			})
		);
	});

	it('deletes team when last member leaves', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			team: { ...mockTeam, members: [hackerUser] } // only member
		} as never);
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);
		db.team.delete.mockResolvedValue(mockTeam as never);

		await caller.team.leaveTeam();

		expect(db.team.delete).toHaveBeenCalledWith({ where: { id: mockTeam.id } });
	});

	it('does not delete team when other members remain', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			team: { ...mockTeam, members: [hackerUser, { uid: 'u2' }] }
		} as never);
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);

		await caller.team.leaveTeam();

		expect(db.team.delete).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST if user is not on a team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: null } as never);

		await expect(caller.team.leaveTeam()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});
});
