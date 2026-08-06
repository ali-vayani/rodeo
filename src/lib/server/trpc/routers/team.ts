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
 * Refuses the caller with the reason that actually applies to them.
 *
 * A judge told "you must be a confirmed attendee" goes and confirms, and is still
 * refused; the rule they're hitting is the role one. See $lib/team/eligibility,
 * which is the single definition every path here shares with the layout that
 * renders the invite banner.
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
	{ uid, teamId }: { uid: string; teamId: string }
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
				 * This used to be a single update of the one invitation `acceptInvite`
				 * happened to be holding, which left the link path writing nothing: someone
				 * emailed an invite who then joined by pasting the link stayed PENDING
				 * forever. Their new team went on listing them under "Pending invitations"
				 * next to their own member row, they went on being offered an Accept button
				 * for a team they were already on, and — because `inviteMember` refuses a
				 * duplicate while one is pending — re-inviting them after they left was
				 * rejected as "already sent" against a row nothing could ever clear.
				 *
				 * Matched on uid *or* address so an invitation written before the account
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

				// You can only be on one team, so an invitation from anyone else is spent
				// too — otherwise it sits in their account offering a join that
				// `addMemberToTeam` would refuse on the already-on-a-team guard above.
				await tx.invitation.updateMany({
					where: { ...addressedToJoiner, teamId: { not: teamId } },
					data: { status: InvitationStatus.DECLINED }
				});

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
								 * PENDING is not enough on its own. `addMemberToTeam` settles these
								 * now, but rows written before it did are still sitting in the
								 * database, and they render as a team listing one of its own members
								 * under "Pending invitations". An invitation to somebody who is on a
								 * team is not pending on anything — they cannot accept it — so it is
								 * filtered on what's true rather than migrated away.
								 *
								 * The `userId: null` arm keeps an invitation to an address with no
								 * account yet, which is genuinely still outstanding.
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
		// addressed to you is spent, whether or not the row says so. Offering an Accept
		// button here only produces the already-on-a-team refusal from `acceptInvite`.
		return { team: user.team, pendingInvitations: user.teamId ? [] : user.invitations };
	}),

	createTeam: authedProcedure
		// Spelled out for the same reason the invite address is: these reach the hacker
		// through the errorFormatter in ../init, and zod's defaults describe a schema
		// rather than the box they just typed in.
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
				include: { members: true }
			});
		}),

	inviteMember: authedProcedure
		// Normalized in the schema, so every use below — the lookup, the duplicate
		// check, and the stored row — sees the same form. Accounts are written
		// lowercased everywhere (auth.ts's Supabase upsert, scan's email lookup), so
		// an invite typed as "Teammate@Example.com" otherwise matches nothing and the
		// inviter is told an account that plainly exists does not.
		//
		// The message is spelled out because zod's default ("Invalid email") reached the
		// inviter as the raw JSON issue array — see the errorFormatter in ../init.
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

			// Ahead of the size check, so re-adding an existing teammate to a full team is
			// answered with the reason that's actually about them. Named rather than
			// swallowed by the generic reply below: it tells the inviter nothing they can't
			// read off the member list they're looking at, and "invitation sent" for
			// somebody already on the team reads as a bug. Covers self-invites too — you
			// are the one account you can't be probing for.
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
			// Distinguishing "no such account" from "not a hacker" from "not confirmed" from
			// "already on a team" turned this into an oracle: any confirmed hacker could probe
			// an arbitrary email and learn whether it registered, what role it holds, whether
			// it was accepted, and whether it RSVP'd. The invite is created when the address
			// maps to an eligible, unteamed user and reports the same "invitation sent" either
			// way otherwise — so a judge's or a mentor's address is quietly a no-op rather
			// than an invitation they could act on. Duplicate invites are the one case worth
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

			// The gate a copied invite link runs into. A judge or mentor holding the URL
			// reaches this endpoint exactly like a hacker does — `canAccessHackerPortal`
			// lets them into /hacker/* — so the role check has to live here, not only in
			// the banner that renders the button.
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

		// One transaction: drop the membership, then delete the team only if the count
		// that remains is zero. Reading members.length outside a transaction let two
		// members leaving at once each see two members, so neither deleted and an empty
		// team survived with a live invite code. `deleteMany` guarded on "no members left"
		// is a no-op for the loser of the race and the delete for the winner.
		await ctx.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { uid: ctx.user.uid }, data: { teamId: null } });

			/**
			 * Leaving puts the account back where it started, which means the invitation
			 * history binding it to this team goes too.
			 *
			 * `teamId = null` alone left the ACCEPTED row from the original invite behind,
			 * and a former member is the one person a team is most likely to re-invite.
			 * That second invite has to be a clean create: the duplicate guard in
			 * `inviteMember` only looks at PENDING rows, but any row still addressed to
			 * someone who is no longer here is a claim about the team that isn't true —
			 * the account it describes has no relationship to it any more. Deleting is the
			 * reset; nothing downstream reads a settled invitation, and a team that is
			 * emptied out cascades these away regardless.
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
