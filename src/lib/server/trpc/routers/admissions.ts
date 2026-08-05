import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { createLog } from '$lib/server/log';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildTemplateVars } from '$lib/email/variables';
import { CLAIM_TTL_MS } from '$lib/admissions/lock';
import { prepareBlacklist, matchApplicant } from '$lib/blacklist/match';

/**
 * Rows this admin is allowed to claim or act on: unclaimed, already theirs (at any
 * age), or expired.
 *
 * Deliberately lenient. Requiring "mine AND fresh" would reject an admin whose own
 * lock aged out by milliseconds mid-review, for no safety gain — this predicate
 * fails in exactly one case: someone else holds a fresh lock.
 *
 * Shared by `claim` and `setDecision` so the two can't drift apart on what
 * "claimable" means.
 */
function claimableBy(uid: string, adminUid: string) {
	return {
		uid,
		OR: [
			{ claimedBy: null },
			{ claimedBy: adminUid },
			{ claimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } }
		]
	};
}

/** Prisma's "no row matched" code, thrown by `update` when the where clause misses. */
function isRecordNotFound(e: unknown): boolean {
	return (
		typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'P2025'
	);
}

export const admissionsRouter = router({
	/**
	 * list all users with optional filters
	 *
	 * Each row carries a `blacklistMatch`, computed here rather than stored, so that entries
	 * added after someone applied still show up against them.
	 *
	 * @param roles - filter by roles
	 * @param decision - filter by decision (pending & active)
	 * @param search - search by name or email
	 */
	list: adminProcedure
		.input(
			z.object({
				roles: z.array(z.nativeEnum(Role)).optional(),
				decision: z.nativeEnum(DecisionStatus).optional(),
				noDecision: z.boolean().optional(),
				search: z.string().optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const { roles, decision, noDecision, search } = input;

			const users = await ctx.prisma.user.findMany({
				where: {
					...(roles?.length && { roles: { hasSome: roles } }),
					...(noDecision && { pendingDecision: null, activeDecision: null }),
					...(decision !== undefined && {
						OR: [{ pendingDecision: decision }, { activeDecision: decision }]
					}),
					...(search && {
						OR: [
							{ name: { contains: search, mode: 'insensitive' as const } },
							{ email: { contains: search, mode: 'insensitive' as const } }
						]
					})
				},
				include: {
					application: { include: { question: true } }
				},
				orderBy: { createdAt: 'desc' }
			});

			// Fuzzy name matching can't be expressed as a WHERE clause, so the blacklist is
			// pulled in full and folded once, then compared against this page of applicants in
			// memory. The table is small by nature -- a few hundred entries at most -- and this
			// keeps the matching rules in one tested module instead of split across SQL.
			const blacklist = prepareBlacklist(
				await ctx.prisma.blacklist.findMany({
					select: { firstName: true, lastName: true, email: true }
				})
			);

			return users.map((user) => ({ ...user, blacklistMatch: matchApplicant(user, blacklist) }));
		}),

	/**
	 * Lightweight presence query — returns all fresh claims (not stale).
	 * Used by clients to poll who is reviewing what.
	 */
	presence: adminProcedure.query(async ({ ctx }) => {
		const now = Date.now();
		const staleThreshold = new Date(now - CLAIM_TTL_MS);
		const rows = await ctx.prisma.user.findMany({
			where: {
				claimedBy: { not: null },
				claimedAt: { gt: staleThreshold }
			},
			select: {
				uid: true,
				claimedBy: true,
				claimedAt: true,
				claimer: { select: { name: true } }
			}
		});
		return rows.map((r) => ({
			uid: r.uid,
			claimedBy: r.claimedBy!,
			claimerName: r.claimer?.name ?? 'Admin',
			// Duration, not a timestamp — the browser's clock may be arbitrarily skewed.
			expiresInMs: Math.max(0, CLAIM_TTL_MS - (now - r.claimedAt!.getTime()))
		}));
	}),

	/**
	 * Attempt to claim an applicant for review.
	 * Succeeds if unclaimed, stale, or already claimed by this admin.
	 * Returns { claimed: true } on success or { claimed: false, claimerName } if another admin holds it.
	 */
	claim: adminProcedure.input(z.object({ uid: z.string() })).mutation(async ({ ctx, input }) => {
		const now = new Date();

		// Enforce one claim per admin — release any other applicant they have open
		await ctx.prisma.user.updateMany({
			where: { claimedBy: ctx.user.uid, uid: { not: input.uid } },
			data: { claimedBy: null, claimedAt: null }
		});

		const result = await ctx.prisma.user.updateMany({
			where: claimableBy(input.uid, ctx.user.uid),
			data: { claimedBy: ctx.user.uid, claimedAt: now }
		});

		if (result.count === 0) {
			const target = await ctx.prisma.user.findUnique({
				where: { uid: input.uid },
				select: { claimer: { select: { name: true } } }
			});
			return {
				claimed: false as const,
				claimerName: target?.claimer?.name ?? 'Another admin',
				expiresInMs: null
			};
		}

		return { claimed: true as const, claimerName: null, expiresInMs: CLAIM_TTL_MS };
	}),

	/**
	 * Release this admin's claim on an applicant.
	 * No-op if the claim is held by someone else.
	 */
	releaseClaim: adminProcedure
		.input(z.object({ uid: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.prisma.user.updateMany({
				where: { uid: input.uid, claimedBy: ctx.user.uid },
				data: { claimedBy: null, claimedAt: null }
			});
			return { ok: true };
		}),

	/**
	 * Heartbeat: refresh claimedAt to extend the lock.
	 * Returns { refreshed: false } if another admin has taken the claim.
	 */
	heartbeat: adminProcedure
		.input(z.object({ uid: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const result = await ctx.prisma.user.updateMany({
				where: { uid: input.uid, claimedBy: ctx.user.uid },
				data: { claimedAt: new Date() }
			});
			return result.count > 0
				? { refreshed: true as const, expiresInMs: CLAIM_TTL_MS }
				: { refreshed: false as const, expiresInMs: null };
		}),

	/**
	 * set a decision for a user and release their claim
	 *
	 * Rejects with CONFLICT if another admin currently holds a fresh claim — this is
	 * what actually prevents two reviewers from overwriting each other. The guard and
	 * the write are a single conditional UPDATE (a compare-and-swap), so there is no
	 * window between checking the lock and taking the decision.
	 *
	 * @param uid - the user's uid
	 * @param decision - the decision to set
	 */
	setDecision: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				decision: z.nativeEnum(DecisionStatus)
			})
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await ctx.prisma.user.update({
					where: claimableBy(input.uid, ctx.user.uid),
					data: {
						pendingDecision: input.decision,
						claimedBy: null,
						claimedAt: null
					}
				});
			} catch (e) {
				if (!isRecordNotFound(e)) throw e;

				// The predicate missed. Disambiguate "no such applicant" from "locked",
				// and name the holder — this only runs on the failure path.
				const target = await ctx.prisma.user.findUnique({
					where: { uid: input.uid },
					select: { name: true, claimer: { select: { name: true } } }
				});
				if (!target) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
				}

				const holder = target.claimer?.name ?? 'Another admin';
				await createLog(
					ctx.prisma,
					`Decision blocked: attempted ${input.decision} on ${target.name} — claimed by ${holder}`,
					ctx.user.uid
				);
				throw new TRPCError({
					code: 'CONFLICT',
					message: `${holder} is reviewing this applicant. Your decision was not saved.`
				});
			}
		}),

	/**
	 * Release pending decisions to active decisions and notify by email.
	 * @param uids - If non-empty, only those users are promoted and emailed (each must have a pending decision). Omitted or empty: all users with a pending decision.
	 */
	release: adminProcedure
		.input(
			z.object({
				uids: z.array(z.string()).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const restrictToUids = Boolean(input.uids?.length);

			const users = await ctx.prisma.user.findMany({
				where: {
					pendingDecision: { not: null },
					...(restrictToUids && { uid: { in: input.uids } })
				}
			});

			if (users.length === 0) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: restrictToUids
						? 'No pending decisions to release for the selected users.'
						: 'No pending decisions to release.'
				});
			}

			// Fetch settings for email templates
			const settings = await ctx.prisma.settings.findFirst();

			// Apply all pending decisions to active decisions in a transaction
			await ctx.prisma.$transaction(
				users.map((u) =>
					ctx.prisma.user.update({
						where: { uid: u.uid },
						data: {
							activeDecision: u.pendingDecision,
							pendingDecision: null,
							// Published decisions end any review session — don't leave the
							// applicant showing as "being reviewed" until the claim goes stale.
							claimedBy: null,
							claimedAt: null
						}
					})
				)
			);

			// Send emails per decision type (fire-and-forget in dev)
			if (settings) {
				const templateMap: Record<string, { subject: string; body: string }> = {
					[DecisionStatus.ACCEPTED]: {
						subject: settings.acceptSubject,
						body: settings.acceptTemplate
					},
					[DecisionStatus.REJECTED]: {
						subject: settings.rejectSubject,
						body: settings.rejectTemplate
					},
					[DecisionStatus.WAITLISTED]: {
						subject: settings.waitlistSubject,
						body: settings.waitlistTemplate
					},
					[DecisionStatus.PENDING]: { subject: '', body: '' }
				};

				await Promise.allSettled(
					users
						.filter((u) => u.pendingDecision && templateMap[u.pendingDecision].body)
						.map((u) =>
							sendTemplatedEmail(
								u.email,
								templateMap[u.pendingDecision!],
								buildTemplateVars(u, settings)
							)
						)
				);
			}

			await createLog(ctx.prisma, `Released decisions for ${users.length} users`, ctx.user.uid);

			return { released: users.length };
		})
});
