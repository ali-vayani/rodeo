import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient, User } from '$lib/generated/prisma/client';
import { DecisionStatus, InvitationStatus, UserStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { TEAM_MEMBER_SELECT } from '$lib/server/trpc/selects';

const MAX_TEAM_SIZE = 4;
const MAX_TEAM_NAME_LENGTH = 64;

/**
 * Who may be on a team: an accepted attendee who has confirmed (or already checked
 * in). One definition, enforced on every path that puts a person on a team, so the
 * gates can't drift — `joinByCode` used to allow CHECKED_IN while `inviteMember`
 * required exactly CONFIRMED, which meant a checked-in attendee could join by link
 * but never be invited.
 */
function isTeamEligible(user: Pick<User, 'activeDecision' | 'status'>): boolean {
	return (
		user.activeDecision === DecisionStatus.ACCEPTED &&
		(user.status === UserStatus.CONFIRMED || user.status === UserStatus.CHECKED_IN)
	);
}

const NOT_ELIGIBLE_MESSAGE = 'You must be a confirmed attendee to manage a team.';

/**
 * Did this write lose a serialization race?
 *
 * Postgres aborts one side of a detected conflict and Prisma surfaces it as
 * P2034 ("write conflict or deadlock"). Matched structurally rather than with an
 * `instanceof` against the generated error class so the check keeps working
 * across client regenerations.
 */
function isWriteConflict(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'P2034'
	);
}

/**
 * Adds a member to a team, refusing if the team filled up in the meantime.
 *
 * The count and the write have to happen inside one serializable transaction.
 * Reading the size and then writing as two separate statements is write skew:
 * three invitees accepting the same instant each see three members, each write
 * succeeds, and the team lands at six with nobody told anything went wrong.
 * `Serializable` makes Postgres detect that overlap and abort the losers, so the
 * ones who didn't get the seat find out.
 *
 * Callers still do their own pre-check first, because the common case is a team
 * that was already full before the request arrived — that deserves the specific
 * message, and this exists for the fraction of a second the pre-check can't cover.
 */
async function addMemberToTeam(
	prisma: PrismaClient,
	{ uid, teamId, invitationId }: { uid: string; teamId: string; invitationId?: string }
) {
	try {
		return await prisma.$transaction(
			async (tx) => {
				// Re-read the joiner *inside* the transaction: acceptInvite/joinByCode
				// checked teamId was null when the request arrived, but a concurrent join
				// could have set it since. Without this, accepting an invite while already
				// on a team silently moves the user and orphans their old team.
				const joiner = await tx.user.findUniqueOrThrow({
					where: { uid },
					select: { teamId: true }
				});
				if (joiner.teamId) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already on a team.' });
				}

				const members = await tx.user.count({ where: { teamId } });
				if (members >= MAX_TEAM_SIZE) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
				}

				if (invitationId) {
					await tx.invitation.update({
						where: { id: invitationId },
						data: { status: InvitationStatus.ACCEPTED }
					});
				}

				return tx.user.update({ where: { uid }, data: { teamId } });
			},
			{ isolationLevel: 'Serializable' }
		);
	} catch (error) {
		// Losing the race and losing the count check are the same outcome from the
		// hacker's side — someone else took the last seat — so a rolled-back
		// transaction gets that answer rather than surfacing as a 500.
		if (isWriteConflict(error)) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
		}
		throw error;
	}
}

export const teamRouter = router({
	getMyTeam: authedProcedure.query(async ({ ctx }) => {
		// Explicit `select`, never `include`: teammates and invitees are other people,
		// and `include` would return their full rows including the embargoed
		// `pendingDecision`. See $lib/server/trpc/selects.
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			select: {
				team: {
					select: {
						id: true,
						teamName: true,
						inviteCode: true,
						members: { select: TEAM_MEMBER_SELECT },
						invitations: {
							where: { status: InvitationStatus.PENDING },
							select: { id: true, email: true, user: { select: TEAM_MEMBER_SELECT } }
						}
					}
				},
				invitations: {
					where: { status: InvitationStatus.PENDING },
					select: {
						id: true,
						email: true,
						team: {
							select: { id: true, teamName: true, members: { select: TEAM_MEMBER_SELECT } }
						}
					}
				}
			}
		});

		return { team: user.team, pendingInvitations: user.invitations };
	}),

	createTeam: authedProcedure
		.input(z.object({ teamName: z.string().trim().min(1).max(MAX_TEAM_NAME_LENGTH) }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

			// Teams are for confirmed attendees. Without this a rejected applicant — or a
			// staff account — could open a team and use inviteMember as an existence oracle.
			if (!isTeamEligible(user)) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_ELIGIBLE_MESSAGE });
			}

			if (user.teamId) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'You are already on a team.'
				});
			}

			return ctx.prisma.team.create({
				data: {
					teamName: input.teamName,
					members: { connect: { uid: ctx.user.uid } }
				},
				include: { members: true }
			});
		}),

	inviteMember: authedProcedure
		// Normalized in the schema, so every use below — the lookup, the duplicate
		// check, and the stored row — sees the same form. Accounts are written
		// lowercased everywhere (auth.ts's Supabase upsert, scan's email lookup), so
		// an invite typed as "Teammate@Example.com" otherwise matches nothing and the
		// inviter is told an account that plainly exists does not.
		.input(z.object({ email: z.string().trim().toLowerCase().email() }))
		.mutation(async ({ ctx, input }) => {
			const inviter = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid },
				include: { team: { include: { members: true } } }
			});

			// The inviter must themselves be a confirmed attendee — mirrors createTeam so a
			// rejected/staff account can't drive this endpoint at all.
			if (!isTeamEligible(inviter)) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_ELIGIBLE_MESSAGE });
			}

			if (!inviter.team) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
			}

			if (inviter.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Team is already full (max 4 members).'
				});
			}

			// One deliberately generic outcome for "not a valid invitee".
			//
			// Distinguishing "no such account" from "not confirmed" from "already on a team"
			// turned this into an oracle: any confirmed attendee could probe an arbitrary
			// email and learn whether it registered, was accepted, and RSVP'd. The invite is
			// created when the address maps to an eligible, unteamed user and reports the same
			// "invitation sent" either way otherwise. Duplicate invites are the one case worth
			// naming, since the inviter is acting on their own team's state, not probing.
			const invitee = await ctx.prisma.user.findUnique({ where: { email: input.email } });

			const inviteeEligible =
				invitee && isTeamEligible(invitee) && !invitee.teamId && invitee.uid !== inviter.uid;

			if (inviteeEligible) {
				const existing = await ctx.prisma.invitation.findFirst({
					where: { teamId: inviter.team.id, email: input.email, status: InvitationStatus.PENDING }
				});
				if (existing) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation already sent.' });
				}

				await ctx.prisma.invitation.create({
					data: {
						teamId: inviter.team.id,
						email: input.email,
						userId: invitee.uid,
						status: InvitationStatus.PENDING
					}
				});
			}

			// Same response whether or not an invitation was actually created.
			return { sent: true as const };
		}),

	acceptInvite: authedProcedure
		.input(z.object({ invitationId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [invitation, accepter] = await Promise.all([
				ctx.prisma.invitation.findUniqueOrThrow({
					where: { id: input.invitationId },
					include: { team: { include: { members: true } } }
				}),
				ctx.prisma.user.findUniqueOrThrow({ where: { uid: ctx.user.uid } })
			]);

			if (invitation.userId !== ctx.user.uid) {
				throw new TRPCError({ code: 'FORBIDDEN' });
			}

			if (invitation.status !== InvitationStatus.PENDING) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation is no longer pending.' });
			}

			// Re-check eligibility at accept time, not just at invite time: a user invited
			// while CONFIRMED could have declined their RSVP since, and a DECLINED attendee
			// must not slip onto a team through a stale invitation.
			if (!isTeamEligible(accepter)) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_ELIGIBLE_MESSAGE });
			}

			if (invitation.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
			}

			await addMemberToTeam(ctx.prisma, {
				uid: ctx.user.uid,
				teamId: invitation.teamId,
				invitationId: input.invitationId
			});

			return { success: true };
		}),

	declineInvite: authedProcedure
		.input(z.object({ invitationId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const invitation = await ctx.prisma.invitation.findUniqueOrThrow({
				where: { id: input.invitationId }
			});

			if (invitation.userId !== ctx.user.uid) {
				throw new TRPCError({ code: 'FORBIDDEN' });
			}

			// Only a pending invite can be declined. Without this, replaying decline on an
			// already-accepted invite flips it to DECLINED while the user stays on the team.
			if (invitation.status !== InvitationStatus.PENDING) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation is no longer pending.' });
			}

			return ctx.prisma.invitation.update({
				where: { id: input.invitationId },
				data: { status: InvitationStatus.DECLINED }
			});
		}),

	joinByCode: authedProcedure
		.input(z.object({ inviteCode: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

			if (!isTeamEligible(user)) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_ELIGIBLE_MESSAGE });
			}

			if (user.teamId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already on a team.' });
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const team = (await (ctx.prisma.team.findUnique as any)({
				where: { inviteCode: input.inviteCode },
				include: { members: true }
			})) as { id: string; teamName: string; members: { uid: string }[] } | null;

			if (!team) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite link not found or expired.' });
			}

			if (team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
			}

			return addMemberToTeam(ctx.prisma, { uid: ctx.user.uid, teamId: team.id });
		}),

	getByInviteCode: authedProcedure
		.input(z.object({ inviteCode: z.string() }))
		.query(async ({ ctx, input }) => {
			const team = await ctx.prisma.team.findUnique({
				where: { inviteCode: input.inviteCode },
				include: { members: true }
			});
			if (!team) return null;
			return {
				teamName: team.teamName,
				memberCount: team.members.length,
				inviteCode: team.inviteCode
			};
		}),

	leaveTeam: authedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			select: { teamId: true }
		});

		if (!user.teamId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
		}

		const teamId = user.teamId;

		// One transaction: drop the membership, then delete the team only if the count
		// that remains is zero. Reading members.length outside a transaction let two
		// members leaving at once each see two members, so neither deleted and an empty
		// team survived with a live invite code. `deleteMany` guarded on "no members left"
		// is a no-op for the loser of the race and the delete for the winner.
		await ctx.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { uid: ctx.user.uid }, data: { teamId: null } });
			const remaining = await tx.user.count({ where: { teamId } });
			if (remaining === 0) {
				await tx.team.delete({ where: { id: teamId } });
			}
		});

		return { success: true };
	})
});
