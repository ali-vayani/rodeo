import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import { ZodError } from 'zod';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { InvitationStatus, DecisionStatus, Role, UserStatus } from '$lib/generated/prisma/client';
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
 * The deep mock resolves it without invoking anything, which would leave the re-count
 * inside the transaction unexercised. Writes inside are then asserted on `db` exactly
 * like writes outside one.
 */
function runTransactions() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- $transaction's overloads can't be spelled at a mock call site.
	db.$transaction.mockImplementation(((fn: any) => fn(db)) as never);
}

/** What Prisma throws when Postgres rolls a serializable transaction back. */
const writeConflict = Object.assign(new Error('write conflict'), { code: 'P2034' });

/**
 * `hackerUser` made team-eligible: ACCEPTED + CONFIRMED. Keeps `hacker-uid` so it stays
 * distinct from `confirmedHacker`, which matters for the self-invite guard. `teamId` is
 * null, so the same object satisfies the in-transaction re-read.
 */
const eligibleHacker = {
	...hackerUser,
	activeDecision: DecisionStatus.ACCEPTED,
	status: UserStatus.CONFIRMED
};

/**
 * Someone with no relationship to `mockTeam`, for the invitee side of the tests.
 * `hackerUser` is a member, so reusing it trips the already-on-your-team guard first.
 */
const outsider = {
	...hackerUser,
	uid: 'outsider-uid',
	email: 'outsider@example.com'
};

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

	it('drops invitations addressed to someone already on a team', async () => {
		// Rows written before joining settled them are still in the database. A member
		// of the caller's own team must not come back as an outstanding invitee.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			teamId: null,
			team: null,
			invitations: []
		} as never);

		await caller.team.getMyTeam();

		expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith(
			expect.objectContaining({
				select: expect.objectContaining({
					team: expect.objectContaining({
						select: expect.objectContaining({
							invitations: expect.objectContaining({
								where: {
									status: InvitationStatus.PENDING,
									OR: [{ userId: null }, { user: { is: { teamId: null } } }]
								}
							})
						})
					})
				})
			})
		);
	});

	it('offers no received invitations to someone who is already on a team', async () => {
		// The stale row the other direction: an Accept button here can only produce
		// `acceptInvite`'s already-on-a-team refusal.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...hackerUser,
			teamId: 'team-1',
			team: mockTeam,
			invitations: [mockInvitation]
		} as never);

		const result = await caller.team.getMyTeam();
		expect(result.pendingInvitations).toEqual([]);
	});
});

describe('team.createTeam', () => {
	it('creates team with current user as member', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, teamId: null } as never);
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
		// Eligible, so the guard reached is the already-on-a-team one, not eligibility.
		db.user.findUniqueOrThrow.mockResolvedValue({
			...eligibleHacker,
			teamId: 'existing-team'
		} as never);

		await expect(caller.team.createTeam({ teamName: 'New Team' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on a team')
		});
	});

	it('throws BAD_REQUEST if the user is not a confirmed attendee', async () => {
		const caller = createTestCaller(db, hackerUser);
		// hackerUser: status CREATED, activeDecision null — not eligible.
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, teamId: null } as never);

		await expect(caller.team.createTeam({ teamName: 'Team Rocket' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('confirmed')
		});
		expect(db.team.create).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST for a confirmed non-hacker, naming the role and not the RSVP', async () => {
		// Telling a judge to confirm their spot sends them to do something that will
		// not help: they already did, and the rule they are hitting is the role one.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...eligibleHacker,
			role: Role.MENTOR,
			teamId: null
		} as never);

		await expect(caller.team.createTeam({ teamName: 'Team Rocket' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('hackers')
		});
		expect(db.team.create).not.toHaveBeenCalled();
	});
});

describe('team.inviteMember', () => {
	it('creates the invitation and returns { sent: true } for an eligible invitee', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue(confirmedHacker as never); // eligible, teamless, other uid
		db.invitation.findFirst.mockResolvedValue(null);
		db.invitation.create.mockResolvedValue(mockInvitation as never);

		const result = await caller.team.inviteMember({ email: confirmedHacker.email });

		expect(result).toEqual({ sent: true });
		expect(db.invitation.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					teamId: 'team-1',
					email: confirmedHacker.email,
					userId: confirmedHacker.uid
				})
			})
		);
	});

	it('lowercases and trims the address before looking it up or storing it', async () => {
		// Regression guard: accounts are stored lowercased, so an invite typed with
		// capitals used to report "User not found." for an account that exists.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
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

	it('reports { sent: true } without creating an invitation when the invitee does not exist', async () => {
		// Anti-oracle: a missing account is indistinguishable from a delivered invite,
		// so the endpoint cannot be used to probe which emails are registered.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue(null);

		const result = await caller.team.inviteMember({ email: 'ghost@example.com' });

		expect(result).toEqual({ sent: true });
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('reports { sent: true } without creating an invitation when the invitee is not eligible', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		// Registered but not a confirmed attendee — must not be revealed or invited.
		db.user.findUnique.mockResolvedValue({ ...outsider, activeDecision: null } as never);

		const result = await caller.team.inviteMember({ email: outsider.email });

		expect(result).toEqual({ sent: true });
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('reports { sent: true } without creating an invitation when the invitee is not a hacker', async () => {
		// A judge, mentor or volunteer clears the same accept/confirm funnel a hacker does,
		// so status alone said yes to them. Silent like every other ineligible case.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue({
			...outsider,
			role: Role.JUDGE,
			status: UserStatus.CONFIRMED,
			activeDecision: DecisionStatus.ACCEPTED
		} as never);

		const result = await caller.team.inviteMember({ email: outsider.email });

		expect(result).toEqual({ sent: true });
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST when the address already belongs to a teammate', async () => {
		// Not an oracle: the inviter is reading their own member list back.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);

		await expect(caller.team.inviteMember({ email: hackerUser.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on your team')
		});
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('rejects a malformed address with a spelled-out reason', async () => {
		// Asserted on the issue rather than the error message, because a direct caller skips
		// the errorFormatter that unwraps it. That half is covered in init.test.ts.
		const caller = createTestCaller(db, hackerUser);

		const rejected = await caller.team
			.inviteMember({ email: 'teammate@' })
			.then(() => null)
			.catch((error: { cause?: unknown }) => error);

		expect(rejected).not.toBeNull();
		expect((rejected as { cause: ZodError }).cause).toBeInstanceOf(ZodError);
		expect((rejected as { cause: ZodError }).cause.issues[0].message).toBe(
			'Enter a valid email address.'
		);
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('reports { sent: true } without creating an invitation when the invitee is already on a team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue({
			...confirmedHacker,
			teamId: 'other-team'
		} as never);

		const result = await caller.team.inviteMember({ email: confirmedHacker.email });

		expect(result).toEqual({ sent: true });
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('refuses a self-invite by name — the inviter is in their own member list', async () => {
		const caller = createTestCaller(db, hackerUser);
		// Inviter and invitee resolve to the same eligible account, which is also the member
		// list's only entry. The `uid !== inviter.uid` check below is the backstop.
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);

		await expect(caller.team.inviteMember({ email: eligibleHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already on your team')
		});
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST if the inviter is not a confirmed attendee', async () => {
		const caller = createTestCaller(db, hackerUser);
		// Inviter itself is ineligible — the endpoint refuses to run at all.
		db.user.findUniqueOrThrow.mockResolvedValue({ ...hackerUser, team: mockTeam } as never);

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('confirmed')
		});
		expect(db.invitation.create).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST if team is full', async () => {
		const caller = createTestCaller(db, hackerUser);
		const fullTeam = {
			...mockTeam,
			members: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }, { uid: 'u4' }]
		};
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: fullTeam } as never);

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});

	it('throws BAD_REQUEST if invite already pending', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ ...eligibleHacker, team: mockTeam } as never);
		db.user.findUnique.mockResolvedValue({ ...confirmedHacker, teamId: null } as never);
		db.invitation.findFirst.mockResolvedValue(mockInvitation as never); // existing pending

		await expect(caller.team.inviteMember({ email: confirmedHacker.email })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already sent')
		});
		expect(db.invitation.create).not.toHaveBeenCalled();
	});
});

describe('team.acceptInvite', () => {
	it('updates teamId and marks invitation ACCEPTED', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid // belongs to this user
		} as never);
		// Accepter lookup (Promise.all) and the in-transaction teamId re-read both hit
		// this mock; eligibleHacker is eligible and has teamId null, satisfying both.
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);

		const result = await caller.team.acceptInvite({ invitationId: 'inv-1' });
		expect(result).toEqual({ success: true });
		// Settled by address/uid rather than by the id the request named, so the same
		// write covers the invite that was accepted and any duplicate left pending.
		expect(db.invitation.updateMany).toHaveBeenCalledWith({
			where: {
				OR: [{ userId: hackerUser.uid }, { email: hackerUser.email }],
				status: InvitationStatus.PENDING,
				teamId: 'team-1'
			},
			data: { status: InvitationStatus.ACCEPTED }
		});
		expect(db.user.update).toHaveBeenCalledWith({
			where: { uid: hackerUser.uid },
			data: { teamId: 'team-1' },
			select: { uid: true, teamId: true }
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
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);
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
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);
		runTransactions();
		db.user.count.mockResolvedValue(4);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
		expect(db.user.update).not.toHaveBeenCalled();
		expect(db.invitation.updateMany).not.toHaveBeenCalled();
	});

	it('reports a rolled-back transaction as a full team, not a 500', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid
		} as never);
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);
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
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);
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
		db.user.findUniqueOrThrow.mockResolvedValue(eligibleHacker as never);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('full')
		});
	});

	it('throws BAD_REQUEST if the accepter is no longer a confirmed attendee', async () => {
		// Re-checked at accept time: a stale invite must not carry a since-declined
		// attendee onto a team.
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid,
			status: InvitationStatus.PENDING
		} as never);
		// Accepter resolves to an ineligible user (status CREATED, activeDecision null).
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);

		await expect(caller.team.acceptInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('confirmed')
		});
		expect(db.$transaction).not.toHaveBeenCalled();
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

	it('throws BAD_REQUEST if the invitation is no longer pending', async () => {
		// Replaying decline on an already-accepted invite must not flip it to DECLINED
		// while the user stays on the team.
		const caller = createTestCaller(db, hackerUser);
		db.invitation.findUniqueOrThrow.mockResolvedValue({
			...mockInvitation,
			userId: hackerUser.uid,
			status: InvitationStatus.ACCEPTED
		} as never);

		await expect(caller.team.declineInvite({ invitationId: 'inv-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('pending')
		});
		expect(db.invitation.update).not.toHaveBeenCalled();
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

	it('settles the pending invitation the joiner never opened', async () => {
		// Regression: invited by email, joined via the link. The invitation stayed PENDING,
		// listing them under "Pending invitations" beside their own member row.
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({ ...mockTeam, members: [hackerUser] } as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);
		db.user.update.mockResolvedValue({ ...confirmedHacker, teamId: 'team-1' } as never);

		await caller.team.joinByCode({ inviteCode: 'code-1' });

		expect(db.invitation.updateMany).toHaveBeenCalledWith({
			where: {
				OR: [{ userId: confirmedHacker.uid }, { email: confirmedHacker.email }],
				status: InvitationStatus.PENDING,
				teamId: 'team-1'
			},
			data: { status: InvitationStatus.ACCEPTED }
		});
	});

	it('kills the joiner’s pending invitations from every other team', async () => {
		// You can only be on one team, so the rest are dead the moment this lands —
		// otherwise they sit in the account offering an Accept that the
		// already-on-a-team guard would refuse.
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.team.findUnique.mockResolvedValue({ ...mockTeam, members: [hackerUser] } as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);
		db.user.update.mockResolvedValue({ ...confirmedHacker, teamId: 'team-1' } as never);

		await caller.team.joinByCode({ inviteCode: 'code-1' });

		expect(db.invitation.updateMany).toHaveBeenCalledWith({
			where: {
				OR: [{ userId: confirmedHacker.uid }, { email: confirmedHacker.email }],
				status: InvitationStatus.PENDING,
				teamId: { not: 'team-1' }
			},
			data: { status: InvitationStatus.DECLINED }
		});
	});

	it('throws BAD_REQUEST for a non-hacker holding the link', async () => {
		// A judge or mentor goes through the same accept/confirm funnel and reaches
		// /hacker/* like anyone else, so status alone let a copied link put them on a
		// team. The banner hides the button, but this is the boundary.
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...confirmedHacker,
			role: Role.JUDGE
		} as never);

		await expect(caller.team.joinByCode({ inviteCode: 'code-1' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('hackers')
		});
		expect(db.$transaction).not.toHaveBeenCalled();
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
			teamId: 'team-1',
			email: hackerUser.email
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(1); // a teammate remains
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

	it('clears the invitations binding the leaver to the team', async () => {
		// `teamId = null` alone left the ACCEPTED row behind, and a former member is
		// exactly who a team re-invites.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			teamId: 'team-1',
			email: hackerUser.email
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(1);
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);

		await caller.team.leaveTeam();

		expect(db.invitation.deleteMany).toHaveBeenCalledWith({
			where: {
				teamId: 'team-1',
				OR: [{ userId: hackerUser.uid }, { email: hackerUser.email }]
			}
		});
	});

	it('deletes team when the last member leaves', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			teamId: 'team-1',
			email: hackerUser.email
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(0); // nobody left after removal
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);
		db.team.delete.mockResolvedValue(mockTeam as never);

		await caller.team.leaveTeam();

		expect(db.user.count).toHaveBeenCalledWith({ where: { teamId: 'team-1' } });
		expect(db.team.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
	});

	it('does not delete team when other members remain', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({
			teamId: 'team-1',
			email: hackerUser.email
		} as never);
		runTransactions();
		db.user.count.mockResolvedValue(2); // others still on the team
		db.user.update.mockResolvedValue({ ...hackerUser, teamId: null } as never);

		await caller.team.leaveTeam();

		expect(db.team.delete).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST if user is not on a team', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue({ teamId: null } as never);

		await expect(caller.team.leaveTeam()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(db.$transaction).not.toHaveBeenCalled();
	});
});
