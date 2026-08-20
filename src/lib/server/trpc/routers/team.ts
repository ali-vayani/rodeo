import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { InvitationStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';
import { TEAM_MEMBER_SELECT } from '$lib/server/trpc/selects';
import {
	isTeamEligible,
	teamIneligibility,
	TEAM_INELIGIBLE_MESSAGE,
	type TeamEligibilitySubject
} from '$lib/team/eligibility';

const MAX_TEAM_SIZE = 4;
const MAX_TEAM_NAME_LENGTH = 64;

/**
 * Refuses the caller with the reason that actually applies to them — a judge told
 * "you must be a confirmed attendee" would confirm and still be refused. See
 * $lib/team/eligibility, shared with the layout that renders the invite banner.
 */
function assertTeamEligible(user: TeamEligibilitySubject): void {
	const reason = teamIneligibility(user);
	if (reason) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: TEAM_INELIGIBLE_MESSAGE[reason] });
	}
}

/**
 * Did this write lose a serialization race?
 *
 * Postgres aborts one side of a detected conflict and Prisma surfaces it as P2034.
 * Matched structurally rather than by `instanceof` so it survives client regeneration.
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
 * The count and the write happen inside one serializable transaction. Reading the
 * size and then writing as two statements is write skew: three invitees accepting at
 * once each see three members, every write succeeds, and the team lands at six.
 *
 * Callers still pre-check, because a team that was already full deserves the specific
 * message; this covers the fraction of a second the pre-check can't.
 */
async function addMemberToTeam(
	prisma: PrismaClient,
	{ uid, teamId }: { uid: string; teamId: string }
) {
	try {
		return await prisma.$transaction(
			async (tx) => {
				// Re-read the joiner *inside* the transaction: the caller checked teamId was
				// null when the request arrived, but a concurrent join could have set it since.
				const joiner = await tx.user.findUniqueOrThrow({
					where: { uid },
					select: { teamId: true, email: true }
				});
				if (joiner.teamId) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already on a team.' });
				}

				const members = await tx.user.count({ where: { teamId } });
				if (members >= MAX_TEAM_SIZE) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
				}

				/**
				 * Landing on a team settles every invitation addressed to this person,
				 * whichever door they came through.
				 *
				 * Updating only the one invitation `acceptInvite` held left the link path
				 * writing nothing, so a joiner stayed PENDING forever — listed under their
				 * own team's "Pending invitations" and un-re-invitable.
				 *
				 * Matched on uid *or* address, so an invitation written before the account
				 * existed (userId null) is caught by the address it was sent to.
				 */
				const addressedToJoiner = {
					OR: [{ userId: uid }, { email: joiner.email }],
					status: InvitationStatus.PENDING
				};

				await tx.invitation.updateMany({
					where: { ...addressedToJoiner, teamId },
					data: { status: InvitationStatus.ACCEPTED }
				});

				// You can only be on one team, so an invitation from anyone else is spent too —
				// otherwise it offers a join that `addMemberToTeam` would refuse.
				await tx.invitation.updateMany({
					where: { ...addressedToJoiner, teamId: { not: teamId } },
					data: { status: InvitationStatus.DECLINED }
				});

				// Projected, never the bare row: `joinByCode` returns this straight to the caller,
				// and a full `User` would leak their embargoed decision. See ../selects.
				return tx.user.update({
					where: { uid },
					data: { teamId },
					select: { uid: true, teamId: true }
				});
			},
			{ isolationLevel: 'Serializable' }
		);
	} catch (error) {
		// Losing the race and losing the count check are the same outcome from the hacker's
		// side — someone else took the last seat — so it isn't surfaced as a 500.
		if (isWriteConflict(error)) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
		}
		throw error;
	}
}

export const teamRouter = router({
	getMyTeam: authedProcedure.query(async ({ ctx }) => {
		// Explicit `select`, never `include`: teammates and invitees are other people, and
		// `include` would return their embargoed `pendingDecision`. See ../selects.
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			select: {
				teamId: true,
				team: {
					select: {
						id: true,
						teamName: true,
						inviteCode: true,
						members: { select: TEAM_MEMBER_SELECT },
						invitations: {
							where: {
								status: InvitationStatus.PENDING,
								/**
								 * PENDING is not enough on its own: rows written before `addMemberToTeam`
								 * settled them are still in the database, and they render as a team listing
								 * one of its own members under "Pending invitations". Filtered on what's
								 * true rather than migrated away.
								 *
								 * The `userId: null` arm keeps invitations to an address with no account yet.
								 */
								OR: [{ userId: null }, { user: { is: { teamId: null } } }]
							},
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

		// The receiving side of the same thing: you are on a team, so every invitation
		// addressed to you is spent, whether or not the row says so.
		return { team: user.team, pendingInvitations: user.teamId ? [] : user.invitations };
	}),

	createTeam: authedProcedure
		// Spelled out because these reach the hacker through the errorFormatter in ../init,
		// and zod's defaults describe a schema rather than the box they just typed in.
		.input(
			z.object({
				teamName: z
					.string()
					.trim()
					.min(1, 'Team name cannot be empty.')
					.max(
						MAX_TEAM_NAME_LENGTH,
						`Team name cannot be longer than ${MAX_TEAM_NAME_LENGTH} characters.`
					)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

			// Teams are for confirmed hackers. Without this a rejected applicant — or a
			// staff account — could open a team and use inviteMember as an existence oracle.
			assertTeamEligible(user);

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
				// Projected, never `include`: the sole member is the caller, and a full row would
				// return their own embargoed decision. See ../selects.
				select: {
					id: true,
					teamName: true,
					inviteCode: true,
					members: { select: TEAM_MEMBER_SELECT }
				}
			});
		}),

	inviteMember: authedProcedure
		// Normalized in the schema so the lookup, the duplicate check and the stored row all
		// see the same form. Accounts are written lowercased everywhere, so an invite typed
		// as "Teammate@Example.com" would otherwise match nothing.
		//
		// The message is spelled out because zod's default reaches the inviter as the raw
		// issue array — see the errorFormatter in ../init.
		.input(
			z.object({
				email: z.string().trim().toLowerCase().email('Enter a valid email address.')
			})
		)
		.mutation(async ({ ctx, input }) => {
			const inviter = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid },
				include: { team: { include: { members: true } } }
			});

			// The inviter must themselves be a confirmed hacker — mirrors createTeam so a
			// rejected/staff account can't drive this endpoint at all.
			assertTeamEligible(inviter);

			if (!inviter.team) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
			}

			// Ahead of the size check, so re-adding an existing teammate to a full team gets the
			// reason that's actually about them. Named rather than swallowed by the generic reply
			// below, since it reveals nothing they can't read off their own member list.
			if (inviter.team.members.some((member) => member.email === input.email)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'They are already on your team.'
				});
			}

			if (inviter.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Team is already full (max 4 members).'
				});
			}

			// One deliberately generic outcome for "not a valid invitee".
			//
			// Distinguishing "no such account" from "not a hacker" from "not confirmed" turned
			// this into an oracle: any confirmed hacker could probe an arbitrary email and learn
			// whether it registered, what role it holds, and whether it was accepted. The invite
			// is created only for an eligible, unteamed user and reports "invitation sent" either
			// way. Duplicate invites are the one case worth naming.
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

			// Re-checked at accept time, not just invite time: a user invited while CONFIRMED
			// could have declined their RSVP since.
			assertTeamEligible(accepter);

			if (invitation.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
			}

			// No invitation id to pass: `addMemberToTeam` settles every invitation this
			// account holds, which is the same write on both the accept and the link path.
			await addMemberToTeam(ctx.prisma, {
				uid: ctx.user.uid,
				teamId: invitation.teamId
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

			// The gate a copied invite link runs into. A judge or mentor holding the URL reaches
			// this endpoint exactly like a hacker does, so the check can't live only in the banner.
			assertTeamEligible(user);

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
			select: { teamId: true, email: true }
		});

		if (!user.teamId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
		}

		const teamId = user.teamId;

		// One transaction: drop the membership, then delete the team only if no members
		// remain. Reading members.length outside a transaction let two members leaving at
		// once each see two, so neither deleted and an empty team survived with a live code.
		await ctx.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { uid: ctx.user.uid }, data: { teamId: null } });

			/**
			 * Leaving puts the account back where it started, so the invitation history
			 * binding it to this team goes too.
			 *
			 * `teamId = null` alone left the ACCEPTED row behind, and a former member is the
			 * one person a team is most likely to re-invite. Any row still addressed to
			 * someone who is no longer here is a claim about the team that isn't true.
			 */
			await tx.invitation.deleteMany({
				where: { teamId, OR: [{ userId: ctx.user.uid }, { email: user.email }] }
			});

			const remaining = await tx.user.count({ where: { teamId } });
			if (remaining === 0) {
				await tx.team.delete({ where: { id: teamId } });
			}
		});

		return { success: true };
	})
});
