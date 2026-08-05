import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { DecisionStatus, InvitationStatus, UserStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure } from '../init';

const MAX_TEAM_SIZE = 4;

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
		const user = await ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			include: {
				team: {
					include: {
						members: true,
						invitations: { include: { user: true } }
					}
				},
				invitations: {
					where: { status: InvitationStatus.PENDING },
					include: { team: { include: { members: true } } }
				}
			}
		});

		return { team: user.team, pendingInvitations: user.invitations };
	}),

	createTeam: authedProcedure
		.input(z.object({ teamName: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

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

			if (!inviter.team) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
			}

			if (inviter.team.members.length >= MAX_TEAM_SIZE) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Team is already full (max 4 members).'
				});
			}

			const invitee = await ctx.prisma.user.findUnique({ where: { email: input.email } });

			if (!invitee) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
			}

			if (
				invitee.activeDecision !== DecisionStatus.ACCEPTED ||
				invitee.status !== UserStatus.CONFIRMED
			) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: "User's attendance is not confirmed."
				});
			}

			if (invitee.teamId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'This user is already on a team.' });
			}

			// Check for existing pending invitation
			const existing = await ctx.prisma.invitation.findFirst({
				where: { teamId: inviter.team.id, email: input.email, status: InvitationStatus.PENDING }
			});

			if (existing) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation already sent.' });
			}

			return ctx.prisma.invitation.create({
				data: {
					teamId: inviter.team.id,
					email: input.email,
					userId: invitee.uid,
					status: InvitationStatus.PENDING
				}
			});
		}),

	acceptInvite: authedProcedure
		.input(z.object({ invitationId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const invitation = await ctx.prisma.invitation.findUniqueOrThrow({
				where: { id: input.invitationId },
				include: { team: { include: { members: true } } }
			});

			if (invitation.userId !== ctx.user.uid) {
				throw new TRPCError({ code: 'FORBIDDEN' });
			}

			if (invitation.status !== InvitationStatus.PENDING) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation is no longer pending.' });
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
		.input(z.object({ invitationId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const invitation = await ctx.prisma.invitation.findUniqueOrThrow({
				where: { id: input.invitationId }
			});

			if (invitation.userId !== ctx.user.uid) {
				throw new TRPCError({ code: 'FORBIDDEN' });
			}

			return ctx.prisma.invitation.update({
				where: { id: input.invitationId },
				data: { status: InvitationStatus.DECLINED }
			});
		}),

	joinByCode: authedProcedure
		.input(z.object({ inviteCode: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: ctx.user.uid }
			});

			if (
				user.activeDecision !== DecisionStatus.ACCEPTED ||
				(user.status !== UserStatus.CONFIRMED && user.status !== UserStatus.CHECKED_IN)
			) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'You must be confirmed or checked in to join a team.'
				});
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
			include: { team: { include: { members: true } } }
		});

		if (!user.team) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are not on a team.' });
		}

		const teamId = user.team.id;
		const isLastMember = user.team.members.length === 1;

		await ctx.prisma.user.update({
			where: { uid: ctx.user.uid },
			data: { teamId: null }
		});

		if (isLastMember) {
			await ctx.prisma.team.delete({ where: { id: teamId } });
		}

		return { success: true };
	})
});
