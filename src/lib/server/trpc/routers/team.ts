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
 * Refuses with the reason that applies: a judge told "you must be a confirmed
 * attendee" would confirm and still be refused. See $lib/team/eligibility.
 */
function assertTeamEligible(user: TeamEligibilitySubject): void {
	const reason = teamIneligibility(user);
	if (reason) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: TEAM_INELIGIBLE_MESSAGE[reason] });
	}
}

/**
 * P2034: Prisma's code for a serialization conflict. Matched structurally rather than
 * by `instanceof` so it survives client regeneration.
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
 * Adds a member to a team. Count and write share one serializable transaction:
 * as two statements that is write skew, where three invitees accepting at once each
 * see three members and the team lands at six. Callers still pre-check so an
 * already-full team gets the specific message.
 *
 * Inputs:
 * - uid: string — the joiner
 * - teamId: string — the team
 *
 * Outputs:
 * - { uid, teamId } — projected, never the bare row; see ../selects
 *
 * Side effects:
 * - Settles every PENDING invitation addressed to the joiner: this team's to ACCEPTED,
 *   any other team's to DECLINED.
 *
 * Throws:
 * - TRPCError BAD_REQUEST — already on a team, or the team is full (including a lost
 *   serialization race, which looks the same from the hacker's side)
 */
async function addMemberToTeam(
	prisma: PrismaClient,
	{ uid, teamId }: { uid: string; teamId: string }
) {
	try {
		return await prisma.$transaction(
			async (tx) => {
				// Re-read inside the transaction: a concurrent join may have set teamId since
				// the caller checked.
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

				// Settled whichever door the joiner came through (accept or link), else a
				// PENDING row lingers under their own team's "Pending invitations". Matched on
				// uid or address so an invitation written before the account existed is caught.
				const addressedToJoiner = {
					OR: [{ userId: uid }, { email: joiner.email }],
					status: InvitationStatus.PENDING
				};

				await tx.invitation.updateMany({
					where: { ...addressedToJoiner, teamId },
					data: { status: InvitationStatus.ACCEPTED }
				});

				// One team only, so other teams' invitations are spent too.
				await tx.invitation.updateMany({
					where: { ...addressedToJoiner, teamId: { not: teamId } },
					data: { status: InvitationStatus.DECLINED }
				});

				return tx.user.update({
					where: { uid },
					data: { teamId },
					select: { uid: true, teamId: true }
				});
			},
			{ isolationLevel: 'Serializable' }
		);
	} catch (error) {
		if (isWriteConflict(error)) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
		}
		throw error;
	}
}

export const teamRouter = router({
	getMyTeam: authedProcedure.query(async ({ ctx }) => {
		// `select`, never `include`: teammates and invitees are other people. See ../selects.
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
								// PENDING rows predating `addMemberToTeam`'s settling still exist and would
								// list a member under "Pending invitations". The `userId: null` arm keeps
								// invitations to an address with no account yet.
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

		// On a team, every invitation addressed to you is spent whether or not the row says so.
		return { team: user.team, pendingInvitations: user.teamId ? [] : user.invitations };
	}),

	createTeam: authedProcedure
		// Messages reach the hacker verbatim via the errorFormatter in ../init.
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

			// Without this a rejected applicant or staff account could open a team and use
			// inviteMember as an existence oracle.
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
				// Projected, never `include`. See ../selects.
				select: {
					id: true,
					teamName: true,
					inviteCode: true,
					members: { select: TEAM_MEMBER_SELECT }
				}
			});
		}),

	inviteMember: authedProcedure
		// Lowercased in the schema so the lookup, duplicate check and stored row agree;
		// accounts are written lowercased. The message reaches the inviter verbatim.
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

			// Mirrors createTeam so a rejected/staff account can't drive this endpoint.
			assertTeamEligible(inviter);

			if (!inviter.team) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
			}

			// Before the size check so the reason is about them. Safe to name: it reveals
			// nothing they can't read off their own member list.
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

			// One generic outcome for "not a valid invitee". Distinguishing "no account" from
			// "not a hacker" from "not confirmed" is an oracle: any hacker could probe an
			// email and learn whether it registered, its role, and whether it was accepted.
			// Duplicate invites are the one case worth naming.
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

			// Re-checked at accept time: they may have declined their RSVP since the invite.
			assertTeamEligible(accepter);

			if (invitation.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Team is already full.' });
			}

			// No invitation id: `addMemberToTeam` settles every invitation this account holds.
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

			// Replaying decline on an accepted invite would flip it to DECLINED while the
			// user stays on the team.
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

			// A judge holding a copied invite URL reaches this endpoint like a hacker does,
			// so the check can't live only in the banner.
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

		// One transaction: two members leaving at once outside one each see two remaining,
		// so neither deletes and an empty team survives with a live invite code.
		await ctx.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { uid: ctx.user.uid }, data: { teamId: null } });

			// Clear the invitation history too: a former member is the person a team is most
			// likely to re-invite, and a leftover ACCEPTED row blocks that.
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
