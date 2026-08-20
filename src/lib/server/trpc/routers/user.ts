import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role, UserStatus, DecisionStatus, InvitationStatus } from '$lib/generated/prisma/client';
import { router, authedProcedure, adminProcedure } from '../init';
import { resolveRecipientWhere, recipientFilterSchema } from '$lib/server/recipients';
import { logAction, valueOrNone } from '$lib/server/log';
import { TEAM_MEMBER_SELECT, SELF_USER_SELECT } from '$lib/server/trpc/selects';

/**
 * One CSV cell, safe to open in a spreadsheet.
 *
 * Quoting is unconditional, because a comma stored in any field silently shifts every
 * column after it.
 *
 * The leading apostrophe is the formula-injection guard. Excel and Sheets treat a cell
 * opening with `=`, `+`, `-` or `@` as a formula, so an applicant who names themselves
 * `=HYPERLINK(...)` gets code running against the roster when an admin opens the file.
 * The apostrophe forces text and is stripped by the spreadsheet on display.
 */
function csvCell(value: string | null | undefined): string {
	const raw = value ?? '';
	// `\t` and `\r` are formula triggers too: Excel treats a cell starting with either
	// (before an `=`/`+`/`-`/`@`) as a formula, so they belong in the neutralization set.
	const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
	return `"${neutralized.replace(/"/g, '""')}"`;
}

export const userRouter = router({
	me: authedProcedure.query(async ({ ctx }) => {
		// Explicit `select`, never `include`. This is `authedProcedure`, so the nested team
		// members and invitees are other people, and an `include` would return their email,
		// status and embargoed `pendingDecision` to any hacker. See ../selects.
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

			// Shared with email.sendCustom / previewRecipients, including the typo-tolerant
			// search, so the count an admin sees and the set that gets mailed cannot diverge.
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

			// `search` reports when the exact term matched nobody and these rows are near-misses
			// instead, and when that suggestion list hit its cap.
			return { users, total, page, pageSize, search: expansion };
		}),

	getById: adminProcedure.input(z.object({ uid: z.string() })).query(async ({ ctx, input }) => {
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: input.uid },
			include: {
				// Answers come back in `question.order`, the order the applicant was asked them in.
				// Sorted here so two readers of this payload cannot disagree about the application.
				application: { include: { question: true }, orderBy: { question: { order: 'asc' } } },
				team: { include: { members: true } },
				scans: { orderBy: { timestamp: 'desc' } }
			}
		});
	}),

	/**
	 * Set an account's role. Singular, and that is the point: roles are mutually exclusive,
	 * so this replaces rather than adds. Granting someone ORGANIZER takes away their
	 * HACKER role, and with it their hacker portal. See `$lib/auth/permissions`.
	 */
	updateRole: adminProcedure
		.input(z.object({ uid: z.string(), role: z.nativeEnum(Role) }))
		.mutation(async ({ ctx, input }) => {
			// Read first so the audit entry can record what the role was. Half of what an audit
			// gets opened to answer is what the value changed from.
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { name: true, role: true }
			});

			// Don't let the platform be left with no admin. Moving someone off ADMIN is refused
			// unless another remains, otherwise a self-demotion locks everyone out with recovery
			// only via the database. Exclusive roles make this matter more: an admin who takes
			// the HACKER role no longer keeps admin alongside it.
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
	 * Manual pending-decision override from /admin/users.
	 *
	 * Intentionally not guarded by the admissions review lock, so it is the escape hatch
	 * if a claim ever wedges. It does clear the claim.
	 *
	 * `activeDecision` is deliberately not settable. An active decision has already been
	 * emailed, and this path sends nothing, so writing it would change what the system
	 * believes without changing what the person was told. The supported way to alter a
	 * published outcome is to set a new pending decision and release it. Enforced at the
	 * input schema rather than only hidden in the UI.
	 *
	 * Once released, this endpoint stops accepting decision edits entirely. Note that this
	 * is currently the last UI path to a released decision: the admissions queue loads with
	 * `noDecision: true`, so released applicants do not appear there to be re-decided.
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

			// A released applicant is off-limits here, whatever the payload says. Thrown rather
			// than ignored, so an admin is told their edit did not happen.
			if (before.activeDecision !== null) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'This decision has already been released and can no longer be changed here.'
				});
			}

			// Reattribute only on a real change. /admin/users saves role, status and decisions in
			// one Promise.all, so stamping `decidedBy` unconditionally would let an unrelated role
			// edit take credit for a decision someone else made.
			const decisionChanged = before.pendingDecision !== input.pendingDecision;

			// Nothing is released at this point (guarded above), so clearing the pending
			// decision leaves nobody accountable and the attribution goes with it.
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

			// Logged as an override rather than a decision: this path bypasses the review lock
			// and the release step.
			await logAction(ctx, {
				action: 'user.decision.override',
				summary:
					`Overrode ${user.name}'s pending decision — ` +
					`${valueOrNone(before.pendingDecision)} to ${valueOrNone(input.pendingDecision)}`,
				target: { id: user.uid, label: user.name },
				// No `activeDecision` key: the guard above means it is always null here.
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

		// A query, but still logged. This is the one call that hands an admin every
		// applicant's name and email in a file.
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
