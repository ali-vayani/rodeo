import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role, UserStatus, DecisionStatus, InvitationStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { resolveRecipientWhere, recipientFilterSchema } from '$lib/server/recipients';
import { logAction, valueOrNone } from '$lib/server/log';
import { TEAM_MEMBER_SELECT, SELF_USER_SELECT } from '$lib/server/trpc/selects';

/**
 * One CSV cell, always quoted, with formula injection neutralised. Excel and Sheets
 * treat a cell opening with `=`, `+`, `-`, `@`, `\t` or `\r` as a formula, so an
 * applicant named `=HYPERLINK(...)` would run code when an admin opens the roster. The
 * leading apostrophe forces text and is hidden on display.
 */
function csvCell(value: string | null | undefined): string {
	const raw = value ?? '';
	const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
	return `"${neutralized.replace(/"/g, '""')}"`;
}

export const userRouter = router({
	me: authedProcedure.query(async ({ ctx }) => {
		// `select`, never `include`: teammates and invitees are other people, and `include`
		// would hand any hacker their embargoed `pendingDecision`. See ../selects.
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: ctx.user.uid },
			select: {
				...SELF_USER_SELECT,
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
							select: {
								id: true,
								teamName: true,
								members: { select: TEAM_MEMBER_SELECT }
							}
						}
					}
				}
			}
		});
	}),

	list: adminProcedure
		.input(
			recipientFilterSchema.extend({
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(200).default(50)
			})
		)
		.query(async ({ ctx, input }) => {
			const { page, pageSize, ...filters } = input;

			// Shared with email.sendCustom so the count shown and the set mailed can't diverge.
			const { where, expansion } = await resolveRecipientWhere(ctx.prisma, filters);

			const [total, users] = await Promise.all([
				ctx.prisma.user.count({ where }),
				ctx.prisma.user.findMany({
					where,
					skip: (page - 1) * pageSize,
					take: pageSize,
					orderBy: { createdAt: 'desc' }
				})
			]);

			// `search` reports when these rows are near-misses for a term that matched nobody.
			return { users, total, page, pageSize, search: expansion };
		}),

	getById: adminProcedure.input(z.object({ uid: z.string() })).query(async ({ ctx, input }) => {
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: input.uid },
			include: {
				// Sorted here so every reader sees answers in the order they were asked.
				application: { include: { question: true }, orderBy: { question: { order: 'asc' } } },
				team: { include: { members: true } },
				scans: { orderBy: { timestamp: 'desc' } }
			}
		});
	}),

	/**
	 * Roles are mutually exclusive, so this replaces rather than adds: granting
	 * ORGANIZER removes HACKER and the hacker portal with it. See `$lib/auth/permissions`.
	 *
	 * Throws:
	 * - TRPCError BAD_REQUEST — demoting the last remaining admin
	 */
	updateRole: adminProcedure
		.input(z.object({ uid: z.string(), role: z.nativeEnum(Role) }))
		.mutation(async ({ ctx, input }) => {
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { name: true, role: true }
			});

			// A self-demotion with no other admin locks everyone out, recoverable only via
			// the database.
			const losingAdmin = before.role === Role.ADMIN && input.role !== Role.ADMIN;
			if (losingAdmin) {
				const otherAdmins = await ctx.prisma.user.count({
					where: { role: Role.ADMIN, uid: { not: input.uid } }
				});
				if (otherAdmins === 0) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'This is the last admin — grant another account admin before removing it.'
					});
				}
			}

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { role: input.role }
			});

			await logAction(ctx, {
				action: 'user.roles.update',
				summary: `Changed ${user.name}'s role to ${input.role}`,
				target: { id: user.uid, label: user.name },
				metadata: { from: before.role, to: input.role }
			});

			return user;
		}),

	updateStatus: adminProcedure
		.input(z.object({ uid: z.string(), status: z.nativeEnum(UserStatus) }))
		.mutation(async ({ ctx, input }) => {
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { status: true }
			});

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: { status: input.status }
			});

			await logAction(ctx, {
				action: 'user.status.update',
				summary: `Changed ${user.name}'s status to ${input.status}`,
				target: { id: user.uid, label: user.name },
				metadata: { from: before.status, to: input.status }
			});

			return user;
		}),

	/**
	 * Manual pending-decision override from /admin/users. Not guarded by the review
	 * lock, so it is the escape hatch if a claim wedges; it does clear the claim.
	 *
	 * `activeDecision` is not settable: it has already been emailed and this path sends
	 * nothing, so writing it would change what the system believes without changing what
	 * the person was told. Once released, this endpoint refuses decision edits entirely.
	 *
	 * Throws:
	 * - TRPCError CONFLICT — the applicant already has a released decision
	 */
	updateDecisions: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				pendingDecision: z.nativeEnum(DecisionStatus).nullable()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { pendingDecision: true, activeDecision: true }
			});

			// Thrown rather than ignored, so the admin is told their edit did not happen.
			if (before.activeDecision !== null) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'This decision has already been released and can no longer be changed here.'
				});
			}

			// Reattribute only on a real change: /admin/users saves role, status and decisions
			// together, so an unrelated edit must not take credit for someone else's decision.
			const decisionChanged = before.pendingDecision !== input.pendingDecision;

			// Clearing the decision clears the attribution with it.
			const attribution = !decisionChanged
				? undefined
				: input.pendingDecision !== null
					? { decidedBy: ctx.user.uid, decidedAt: new Date() }
					: { decidedBy: null, decidedAt: null };

			const user = await ctx.prisma.user.update({
				where: { uid: input.uid },
				data: {
					pendingDecision: input.pendingDecision,
					...attribution,
					claimedBy: null,
					claimedAt: null
				}
			});

			// An override, not a decision: this path bypasses the review lock and release.
			await logAction(ctx, {
				action: 'user.decision.override',
				summary:
					`Overrode ${user.name}'s pending decision — ` +
					`${valueOrNone(before.pendingDecision)} to ${valueOrNone(input.pendingDecision)}`,
				target: { id: user.uid, label: user.name },
				metadata: {
					pendingFrom: before.pendingDecision,
					pendingTo: input.pendingDecision
				}
			});

			return user;
		}),

	exportCsv: adminProcedure.query(async ({ ctx }) => {
		const users = await ctx.prisma.user.findMany({
			orderBy: { createdAt: 'desc' }
		});

		// A query, but logged: it hands an admin every applicant's name and email in a file.
		await logAction(ctx, {
			action: 'user.export',
			summary: `Exported the user list (${users.length} users)`,
			metadata: { count: users.length }
		});

		const header = 'uid,name,email,role,status,pendingDecision,activeDecision,teamId,createdAt';
		const rows = users.map((u) =>
			[
				u.uid,
				u.name,
				u.email,
				u.role,
				u.status,
				u.pendingDecision ?? '',
				u.activeDecision ?? '',
				u.teamId ?? '',
				u.createdAt.toISOString()
			]
				.map(csvCell)
				.join(',')
		);

		return [header, ...rows].join('\n');
	})
});
