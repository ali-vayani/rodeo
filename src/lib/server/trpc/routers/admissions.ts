import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '$lib/generated/prisma/client';
import { Role, DecisionStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { emailSettings } from '$lib/server/settings';
import { CLAIM_TTL_MS } from '$lib/admissions/lock';
import { effectiveDecision } from '$lib/admissions/decision';
import { MAX_SCORE, MIN_SCORE } from '$lib/admissions/score';
import { APPLICANT_ROLES, narrowToApplicants } from '$lib/admissions/roles';
import { prepareBlacklist, matchApplicant } from '$lib/blacklist/match';
import {
	NO_EXPANSION,
	expandSearch,
	answerFilterSchema,
	linkedFieldConditions,
	linkedFieldFilterSchema,
	resolveAnswerConditions,
	searchCondition
} from '$lib/server/recipients';

/**
 * Rows this admin may claim or act on: unclaimed, already theirs (at any age), or
 * expired. Fails in exactly one case: someone else holds a fresh lock.
 *
 * Shared by `claim` and `setDecision` so the two can't drift on what "claimable" means.
 */
function claimableBy(uid: string, adminUid: string) {
	return {
		uid,
		// Never a staff account: an ADMIN/ORGANIZER has no application, and the uid can
		// arrive from a hand-edited request.
		role: { in: APPLICANT_ROLES },
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

/**
 * Applicants nobody has decided on yet — the population both passes work through.
 *
 * One predicate rather than three copies, so `stats` and `list` cannot count
 * different sets. A literal `PENDING` reads as no decision: it is the enum's
 * starting value, and `setDecision` refuses to write it.
 */
const UNDECIDED: Prisma.UserWhereInput = {
	OR: [{ pendingDecision: null }, { pendingDecision: DecisionStatus.PENDING }],
	activeDecision: null
};

export const admissionsRouter = router({
	/**
	 * List applicants with optional filters.
	 *
	 * Scoped to APPLICANT_ROLES — never staff. Each row carries a `blacklistMatch`,
	 * computed here rather than stored, so entries added after someone applied still
	 * show up against them.
	 *
	 * This router's predicate matches `pendingDecision` OR `activeDecision`, where
	 * `buildRecipientWhere` reads only the released `activeDecision`; the parts that
	 * must be identical (search clause, linked-field filters) are imported, not restated.
	 *
	 * Returns `{ applicants, search }` so the queue can report a typo-tolerant fallback
	 * rather than looking like an empty queue on a misspelled search.
	 *
	 * @param roles - narrow further within the applicant roles; staff roles match nothing
	 * @param decision - filter by decision (pending & active)
	 * @param search - search by name or email, with a typo-tolerant fallback
	 * @param scored - true: only applicants a reviewer has scored; false: only unscored
	 * @param sort - `score` ranks highest-first for the decision pass; `recent` is the queue's own order
	 * @param names/universities/years - linked application fields; `[]` matches nobody
	 * @param answers/states - other application answers, and the state derived from a university
	 */
	list: adminProcedure
		.input(
			z.object({
				roles: z.array(z.nativeEnum(Role)).optional(),
				decision: z.nativeEnum(DecisionStatus).optional(),
				noDecision: z.boolean().optional(),
				scored: z.boolean().optional(),
				sort: z.enum(['recent', 'score']).default('recent'),
				search: z.string().optional(),
				...linkedFieldFilterSchema.shape,
				...answerFilterSchema.shape
			})
		)
		.query(async ({ ctx, input }) => {
			const { roles, decision, noDecision, scored, sort, search } = input;

			// Always bounded to applicant roles, so staff stay out of the queue even on the
			// "All" tab, which sends no role filter of its own.
			const applicantRoles = narrowToApplicants(roles);
			if (applicantRoles.length === 0) return { applicants: [], search: NO_EXPANSION };

			// Stacked under AND: the decision and search filters each contribute an `OR`, and
			// spreading both into one object literal silently drops the first.
			const conditions: Prisma.UserWhereInput[] = [{ role: { in: applicantRoles } }];
			if (noDecision) conditions.push(UNDECIDED);
			if (scored !== undefined) conditions.push({ score: scored ? { not: null } : null });
			if (decision !== undefined) {
				conditions.push({ OR: [{ pendingDecision: decision }, { activeDecision: decision }] });
			}
			conditions.push(...linkedFieldConditions(input));
			// Answers living in `ApplicationResponse`, plus the derived state filter. Pushed
			// before the search probe so the probe counts inside the queue being shown.
			conditions.push(...(await resolveAnswerConditions(ctx.prisma, input)));

			// Runs after every other condition so it counts exact hits *inside this queue*
			// rather than across the whole User table. The search clause is appended after,
			// because it is built from the expansion this probe decides.
			const expansion = await expandSearch(ctx.prisma, search, conditions);
			const searchClause = searchCondition(search, expansion);
			if (searchClause) conditions.push(searchClause);

			const users = await ctx.prisma.user.findMany({
				where: { AND: conditions },
				include: {
					application: { include: { question: true } },
					// An unattributed note is a note nobody can follow up on.
					scorer: { select: { name: true } }
				},
				// Ties break on earliest applied rather than planner order: the ranked list is
				// worked top-down, so two applicants on 17 must not swap places between reloads.
				orderBy:
					sort === 'score'
						? [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }]
						: { createdAt: 'desc' }
			});

			// Fuzzy name matching can't be expressed as a WHERE clause, so the blacklist is
			// pulled in full and folded once. The table is a few hundred entries at most.
			const blacklist = prepareBlacklist(
				await ctx.prisma.blacklist.findMany({
					select: { firstName: true, lastName: true, email: true }
				})
			);

			return {
				applicants: users.map((user) => ({
					...user,
					blacklistMatch: matchApplicant(user, blacklist)
				})),
				search: expansion
			};
		}),

	/** All fresh (non-stale) claims — clients poll this to see who is reviewing what. */
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
	 * Returns { claimed: true }, or { claimed: false, claimerName } if someone else holds it.
	 *
	 * Deliberately unaudited, as are `releaseClaim` and `heartbeat` — a reviewer
	 * generates these every few seconds, and the volume would bury real decisions.
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
	 * Set a decision for a user and release their claim.
	 *
	 * Rejects with CONFLICT if another admin holds a fresh claim. The guard and the write
	 * are a single conditional UPDATE, so there is no window between the two.
	 *
	 * @param uid - the user's uid
	 * @param decision - the decision to set
	 */
	setDecision: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				// PENDING is a starting state, not a decision anyone reviews toward. Allowing it
				// let `release` promote `activeDecision: PENDING` and email nothing.
				decision: z.enum([
					DecisionStatus.ACCEPTED,
					DecisionStatus.REJECTED,
					DecisionStatus.WAITLISTED
				])
			})
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const applicant = await ctx.prisma.user.update({
					where: claimableBy(input.uid, ctx.user.uid),
					data: {
						pendingDecision: input.decision,
						// Set in the same statement as the decision: the CAS above can miss, and
						// attribution must never land without its decision.
						decidedBy: ctx.user.uid,
						decidedAt: new Date(),
						claimedBy: null,
						claimedAt: null
					}
				});

				await logAction(ctx, {
					action: 'admissions.decision.set',
					// "Set a pending decision", not "accepted" — nothing reaches the applicant
					// until release.
					summary: `Set ${applicant.name}'s pending decision to ${input.decision}`,
					target: { id: applicant.uid, label: applicant.name },
					metadata: { decision: input.decision }
				});

				return applicant;
			} catch (e) {
				if (!isRecordNotFound(e)) throw e;

				// The predicate missed. Disambiguate "no such applicant" from "locked" and
				// name the holder — this only runs on the failure path.
				const target = await ctx.prisma.user.findUnique({
					where: { uid: input.uid },
					select: { name: true, claimer: { select: { name: true } } }
				});
				if (!target) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
				}

				const holder = target.claimer?.name ?? 'Another admin';
				await logAction(ctx, {
					action: 'admissions.decision.blocked',
					summary: `Tried to set ${target.name} to ${input.decision} — blocked, claimed by ${holder}`,
					target: { id: input.uid, label: target.name },
					metadata: { decision: input.decision, heldBy: holder }
				});
				throw new TRPCError({
					code: 'CONFLICT',
					message: `${holder} is reviewing this applicant. Your decision was not saved.`
				});
			}
		}),

	/**
	 * Clear a pending decision, returning the applicant to the undecided queue.
	 *
	 * Only affects `pendingDecision` — a released `activeDecision` is permanent. Uses
	 * the same claim CAS as `setDecision`, and clears attribution alongside the decision.
	 */
	clearDecision: adminProcedure
		.input(z.object({ uid: z.string() }))
		.mutation(async ({ ctx, input }) => {
			try {
				const applicant = await ctx.prisma.user.update({
					where: claimableBy(input.uid, ctx.user.uid),
					data: {
						pendingDecision: null,
						decidedBy: null,
						decidedAt: null,
						claimedBy: null,
						claimedAt: null
					}
				});

				await logAction(ctx, {
					action: 'admissions.decision.clear',
					summary: `Cleared ${applicant.name}'s pending decision`,
					target: { id: applicant.uid, label: applicant.name }
				});

				return applicant;
			} catch (e) {
				if (!isRecordNotFound(e)) throw e;

				const target = await ctx.prisma.user.findUnique({
					where: { uid: input.uid },
					select: { name: true, claimer: { select: { name: true } } }
				});
				if (!target) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
				}
				throw new TRPCError({
					code: 'CONFLICT',
					message: `${target.claimer?.name ?? 'Another admin'} is reviewing this applicant. Your change was not saved.`
				});
			}
		}),

	/**
	 * Score an applicant 0–20 and save the reviewer's notes.
	 *
	 * Scoring deliberately sets no decision: nobody is accepted or rejected until the
	 * queue has been scored and can be ranked against itself. Guarded by the same claim
	 * CAS as `setDecision`, and releases the claim on success. Re-scoring overwrites,
	 * including the attribution.
	 *
	 * @param uid - the applicant
	 * @param score - whole number within the shared scale
	 * @param notes - free text shown to every admin during the decision pass; blank clears
	 */
	setScore: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
				// Always sent by the review pane, blank included — that is what makes deleting
				// a note possible.
				notes: z.string().max(5000).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const notes = input.notes?.trim() || null;
			try {
				const applicant = await ctx.prisma.user.update({
					where: claimableBy(input.uid, ctx.user.uid),
					data: {
						score: input.score,
						notes,
						scoredBy: ctx.user.uid,
						scoredAt: new Date(),
						claimedBy: null,
						claimedAt: null
					}
				});

				await logAction(ctx, {
					action: 'admissions.score.set',
					summary: `Scored ${applicant.name} ${input.score}/${MAX_SCORE}`,
					target: { id: applicant.uid, label: applicant.name },
					metadata: { score: input.score, hasNotes: notes !== null }
				});

				return applicant;
			} catch (e) {
				if (!isRecordNotFound(e)) throw e;

				const target = await ctx.prisma.user.findUnique({
					where: { uid: input.uid },
					select: { name: true, claimer: { select: { name: true } } }
				});
				if (!target) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
				}

				throw new TRPCError({
					code: 'CONFLICT',
					message: `${target.claimer?.name ?? 'Another admin'} is reviewing this applicant. Your score was not saved.`
				});
			}
		}),

	/**
	 * Set the same pending decision on many applicants at once — the decision pass
	 * working down the ranked list, or taking everyone above a score cutoff.
	 *
	 * One statement rather than a loop over `setDecision`, so a partial failure can't
	 * leave the operator guessing which half landed. Rows another admin holds a fresh
	 * claim on come back as `skipped` rather than being overwritten.
	 *
	 * @param uids - applicants to decide; non-applicants are ignored
	 * @param decision - the pending decision to apply to all of them
	 */
	setDecisions: adminProcedure
		.input(
			z.object({
				uids: z.array(z.string()).min(1),
				decision: z.enum([
					DecisionStatus.ACCEPTED,
					DecisionStatus.REJECTED,
					DecisionStatus.WAITLISTED
				])
			})
		)
		.mutation(async ({ ctx, input }) => {
			const result = await ctx.prisma.user.updateMany({
				where: {
					uid: { in: input.uids },
					// A uid list arrives from the client, so the role guard is what keeps a stale
					// or hand-edited selection from putting a decision on staff.
					role: { in: APPLICANT_ROLES },
					OR: [
						{ claimedBy: null },
						{ claimedBy: ctx.user.uid },
						{ claimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } }
					]
				},
				data: {
					pendingDecision: input.decision,
					decidedBy: ctx.user.uid,
					decidedAt: new Date(),
					claimedBy: null,
					claimedAt: null
				}
			});

			const skipped = input.uids.length - result.count;

			await logAction(ctx, {
				action: 'admissions.decision.bulk',
				summary:
					`Set ${result.count} pending ${result.count === 1 ? 'decision' : 'decisions'} to ${input.decision}` +
					(skipped > 0 ? ` — ${skipped} skipped (claimed or not an applicant)` : ''),
				metadata: { decision: input.decision, updated: result.count, skipped }
			});

			return { updated: result.count, skipped };
		}),

	/**
	 * Headline counts for the admissions page.
	 *
	 * Decisions are counted at their *effective* value — pending if there is one,
	 * otherwise released — which is what the page's own list shows.
	 */
	stats: adminProcedure.query(async ({ ctx }) => {
		const applicants = { role: { in: APPLICANT_ROLES } };

		const [rows, scored, unscored] = await Promise.all([
			ctx.prisma.user.groupBy({
				by: ['pendingDecision', 'activeDecision'],
				where: applicants,
				_count: { _all: true }
			}),
			ctx.prisma.user.count({ where: { ...applicants, ...UNDECIDED, score: { not: null } } }),
			ctx.prisma.user.count({ where: { ...applicants, ...UNDECIDED, score: null } })
		]);

		const tally = { accepted: 0, rejected: 0, waitlisted: 0, undecided: 0, pending: 0 };
		for (const row of rows) {
			const effective = effectiveDecision(row);
			const count = row._count._all;
			if (effective === DecisionStatus.ACCEPTED) tally.accepted += count;
			else if (effective === DecisionStatus.REJECTED) tally.rejected += count;
			else if (effective === DecisionStatus.WAITLISTED) tally.waitlisted += count;
			else tally.undecided += count;

			// Cuts across the three above: `pending` counts decisions that exist but haven't
			// been emailed, which is what the release gate acts on.
			if (row.pendingDecision !== null && row.pendingDecision !== DecisionStatus.PENDING) {
				tally.pending += count;
			}
		}

		// Both halves of the scoring queue, which together are `undecided`. The decision
		// pass only sees the scored half, so the unscored count says how much it can't see.
		return { ...tally, scored, unscored };
	}),

	/**
	 * Per-role decision breakdown and score aggregates for the Stats tab. Kept separate
	 * from `stats` so the header counts never pay for this heavier query.
	 */
	decisionStats: adminProcedure.query(async ({ ctx }) => {
		const [roleGroups, scoreAgg] = await Promise.all([
			ctx.prisma.user.groupBy({
				by: ['role', 'pendingDecision', 'activeDecision'],
				where: { role: { in: APPLICANT_ROLES } },
				_count: { _all: true }
			}),
			ctx.prisma.user.aggregate({
				where: { role: { in: APPLICANT_ROLES }, score: { not: null } },
				_avg: { score: true },
				_min: { score: true },
				_max: { score: true },
				_count: { score: true }
			})
		]);

		// Tally per-role decision counts from the groupBy rows.
		const roleMap = new Map<
			string,
			{ total: number; accepted: number; waitlisted: number; rejected: number; undecided: number }
		>();
		for (const g of roleGroups) {
			const role = g.role as string;
			if (!roleMap.has(role)) {
				roleMap.set(role, { total: 0, accepted: 0, waitlisted: 0, rejected: 0, undecided: 0 });
			}
			const tally = roleMap.get(role)!;
			tally.total += g._count._all;
			const effective = effectiveDecision(g);
			if (effective === DecisionStatus.ACCEPTED) tally.accepted += g._count._all;
			else if (effective === DecisionStatus.WAITLISTED) tally.waitlisted += g._count._all;
			else if (effective === DecisionStatus.REJECTED) tally.rejected += g._count._all;
			else tally.undecided += g._count._all;
		}

		const byRole = [...roleMap.entries()]
			.map(([role, tally]) => ({ role, ...tally }))
			.sort((a, b) => b.total - a.total);

		return {
			byRole,
			scores: {
				avg: scoreAgg._avg.score !== null ? Math.round(scoreAgg._avg.score * 10) / 10 : null,
				min: scoreAgg._min.score,
				max: scoreAgg._max.score,
				count: scoreAgg._count.score
			}
		};
	}),

	/**
	 * Applicants who already have a released decision and may need reconsidering.
	 *
	 * Sorted by actionability — waitlisted, then rejected, then accepted. Sorted in
	 * application code because Prisma has no enum-priority ORDER BY.
	 */
	reconsidering: adminProcedure.query(async ({ ctx }) => {
		const users = await ctx.prisma.user.findMany({
			where: { role: { in: APPLICANT_ROLES }, activeDecision: { not: null } },
			include: {
				application: { include: { question: true } },
				scorer: { select: { name: true } }
			}
		});

		const blacklist = prepareBlacklist(
			await ctx.prisma.blacklist.findMany({
				select: { firstName: true, lastName: true, email: true }
			})
		);

		const PRIORITY: Partial<Record<string, number>> = {
			WAITLISTED: 0,
			REJECTED: 1,
			ACCEPTED: 2
		};

		return users
			.map((user) => ({ ...user, blacklistMatch: matchApplicant(user, blacklist) }))
			.sort((a, b) => (PRIORITY[a.activeDecision!] ?? 99) - (PRIORITY[b.activeDecision!] ?? 99));
	}),

	/**
	 * Per-reviewer scoring activity — who scored how many applicants and when they last
	 * did so. Grouped in the DB rather than counted in app code: one scan, not N rows.
	 */
	reviewerStats: adminProcedure.query(async ({ ctx }) => {
		const groups = await ctx.prisma.user.groupBy({
			by: ['scoredBy'],
			where: { scoredBy: { not: null } },
			_count: { _all: true },
			_max: { scoredAt: true }
		});

		const adminUids = groups.map((g) => g.scoredBy!);
		const admins = await ctx.prisma.user.findMany({
			where: { uid: { in: adminUids } },
			select: { uid: true, name: true }
		});
		const nameMap = Object.fromEntries(admins.map((a) => [a.uid, a.name]));

		return groups
			.map((g) => ({
				uid: g.scoredBy!,
				name: nameMap[g.scoredBy!] ?? 'Unknown',
				scored: g._count._all,
				lastScoredAt: g._max.scoredAt
			}))
			.sort((a, b) => b.scored - a.scored);
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
					// Applicants only, mirroring `setDecisions`: a stale or hand-edited uid list must
					// not promote and email a decision onto a staff account.
					role: { in: APPLICANT_ROLES },
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

			const settings = await ctx.prisma.settings.findFirst();

			// Compare-and-swap keyed on the exact value we read. Keying on `uid` alone would
			// let a change landing between the read and here be overwritten — and email the
			// applicant that stale, irreversible outcome. A moved row is dropped from the batch.
			const swaps = await ctx.prisma.$transaction(
				users.map((u) =>
					ctx.prisma.user.updateMany({
						where: { uid: u.uid, pendingDecision: u.pendingDecision },
						data: {
							activeDecision: u.pendingDecision,
							pendingDecision: null,
							// `decidedBy`/`decidedAt` are deliberately untouched: release publishes
							// decisions other admins made. Clearing the claim ends the review session.
							claimedBy: null,
							claimedAt: null
						}
					})
				)
			);

			// Only users whose swap actually took are released — and get mailed.
			const releasedUsers = users.filter((_, i) => swaps[i].count === 1);

			// Defaults when no Settings row exists: gating on the row meant a release on an
			// unconfigured install decided every applicant's fate and told none of them.
			const mail = emailSettings(settings);
			const templateMap: Record<string, { subject: string; body: string }> = {
				[DecisionStatus.ACCEPTED]: {
					subject: mail.acceptSubject,
					body: mail.acceptTemplate
				},
				[DecisionStatus.REJECTED]: {
					subject: mail.rejectSubject,
					body: mail.rejectTemplate
				},
				[DecisionStatus.WAITLISTED]: {
					subject: mail.waitlistSubject,
					body: mail.waitlistTemplate
				},
				[DecisionStatus.PENDING]: { subject: '', body: '' }
			};

			const recipients = releasedUsers.filter(
				(u) => u.pendingDecision && templateMap[u.pendingDecision].body
			);
			const emailsAttempted = recipients.length;

			const results = await Promise.allSettled(
				recipients.map(async (u) => {
					// Raw row, not `mail`: the check-in block's wallet gate must fail closed
					// on an unconfigured install — see buildEmailPersonalization.
					const { vars, attachments } = await buildEmailPersonalization(u, settings);
					return sendTemplatedEmail(u.email, templateMap[u.pendingDecision!], vars, attachments);
				})
			);
			const emailsFailed = results.filter((r) => r.status === 'rejected').length;

			// Release is the one irreversible batch action, so its entry carries the full
			// breakdown: who was affected, what each decision was, and how many were notified.
			const byDecision: Record<string, number> = {};
			for (const u of releasedUsers) {
				const key = u.pendingDecision ?? 'none';
				byDecision[key] = (byDecision[key] ?? 0) + 1;
			}

			// A row can be skipped if its pending decision moved between read and swap —
			// surface that rather than silently reporting fewer released.
			const skipped = users.length - releasedUsers.length;

			await logAction(ctx, {
				action: 'admissions.release',
				summary:
					`Released ${releasedUsers.length} ${releasedUsers.length === 1 ? 'decision' : 'decisions'} ` +
					`(${Object.entries(byDecision)
						.map(([decision, count]) => `${count} ${decision.toLowerCase()}`)
						.join(', ')})` +
					(skipped > 0 ? ` — ${skipped} changed mid-release and were skipped` : '') +
					(emailsFailed > 0 ? ` — ${emailsFailed} emails failed to send` : ''),
				metadata: {
					released: releasedUsers.length,
					...byDecision,
					scope: restrictToUids ? 'selected' : 'all pending',
					skipped,
					emailsAttempted,
					emailsFailed
				}
			});

			return { released: releasedUsers.length };
		})
});
