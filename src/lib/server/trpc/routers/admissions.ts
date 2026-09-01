import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '$lib/generated/prisma/client';
import { Role, DecisionStatus, UserStatus } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { sendTemplatedEmail } from '$lib/server/email';
import { buildEmailPersonalization } from '$lib/server/wallet/email-block';
import { templateBlockers } from '$lib/email/variables';
import { emailSettings } from '$lib/server/settings';
import { CLAIM_TTL_MS } from '$lib/admissions/lock';
import { effectiveDecision } from '$lib/admissions/decision';
import { MAX_SCORE, MIN_SCORE } from '$lib/admissions/score';
import { MAX_DELTA, rubricMaxScore } from '$lib/admissions/rubric';
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
 * Where clause for rows this admin may claim or act on: unclaimed, already theirs, or
 * expired. Misses only when someone else holds a fresh lock. Shared by `claim` and the
 * decision/score writes so "claimable" can't drift.
 */
function claimableBy(uid: string, adminUid: string) {
	return {
		uid,
		// The uid can arrive from a hand-edited request; never touch a staff account.
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
 * Applicants nobody has decided on yet. Shared so `stats` and `list` count the same set.
 * A literal `PENDING` reads as no decision: it is the enum's starting value, and
 * `setDecision` refuses to write it.
 */
const UNDECIDED: Prisma.UserWhereInput = {
	OR: [{ pendingDecision: null }, { pendingDecision: DecisionStatus.PENDING }],
	activeDecision: null
};

/**
 * Applicants who submitted. `CREATED` is the pre-submit state and every later status
 * follows a submit, so ruling it out is exactly "applied" — an account that signed up
 * and stopped is not something to review.
 */
const SUBMITTED: Prisma.UserWhereInput = { status: { not: UserStatus.CREATED } };

export const admissionsRouter = router({
	/**
	 * Lists applicants (never staff) with optional filters. `blacklistMatch` is computed
	 * per row rather than stored, so entries added after someone applied still show.
	 *
	 * Decision filters match `pendingDecision` OR `activeDecision`, unlike
	 * `buildRecipientWhere`, which reads only the released value; the shared parts
	 * (search clause, linked-field filters) are imported, not restated.
	 *
	 * Inputs:
	 * - roles: Role[] — narrows within the applicant roles; staff roles match nothing
	 * - decision: DecisionStatus — pending or active
	 * - scored: boolean — true: scored only; false: unscored only
	 * - sort: 'recent' | 'score' — `score` ranks highest-first for the decision pass
	 * - search: string — name or email, with a typo-tolerant fallback
	 * - names/universities/years, answers/states — see $lib/server/recipients; `[]` matches nobody
	 *
	 * Outputs:
	 * - { applicants, search } — `search` reports the fallback so a misspelling doesn't
	 *   look like an empty queue
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

			// The "All" tab sends no role filter; staff must still stay out.
			const applicantRoles = narrowToApplicants(roles);
			if (applicantRoles.length === 0) return { applicants: [], search: NO_EXPANSION };

			// Stacked under AND: the decision and search filters each contribute an `OR`, and
			// spreading both into one object literal silently drops the first.
			const conditions: Prisma.UserWhereInput[] = [{ role: { in: applicantRoles } }, SUBMITTED];
			if (noDecision) conditions.push(UNDECIDED);
			if (scored !== undefined) conditions.push({ score: scored ? { not: null } : null });
			if (decision !== undefined) {
				conditions.push({ OR: [{ pendingDecision: decision }, { activeDecision: decision }] });
			}
			conditions.push(...linkedFieldConditions(input));
			conditions.push(...(await resolveAnswerConditions(ctx.prisma, input)));

			// Last, so the probe counts exact hits inside this queue rather than across the
			// whole User table; the search clause is built from the expansion it decides.
			const expansion = await expandSearch(ctx.prisma, search, conditions);
			const searchClause = searchCondition(search, expansion);
			if (searchClause) conditions.push(searchClause);

			const users = await ctx.prisma.user.findMany({
				where: { AND: conditions },
				include: {
					application: { include: { question: true } },
					scorer: { select: { name: true } },
					// So reopening the rubric modal shows the cells behind a saved score.
					rubricSelections: { select: { criterionId: true, levelId: true } }
				},
				// Ties break on earliest applied so the ranked list is stable between reloads.
				orderBy:
					sort === 'score'
						? [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }]
						: { createdAt: 'desc' }
			});

			// Fuzzy name matching can't be a WHERE clause; the table is a few hundred rows.
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
			// Duration, not a timestamp: the browser's clock may be skewed.
			expiresInMs: Math.max(0, CLAIM_TTL_MS - (now - r.claimedAt!.getTime()))
		}));
	}),

	/**
	 * Claims an applicant for review. Succeeds if unclaimed, stale, or already this
	 * admin's; otherwise returns `{ claimed: false, claimerName }`.
	 *
	 * Unaudited, as are `releaseClaim` and `heartbeat`: a reviewer generates these every
	 * few seconds and the volume would bury real decisions.
	 */
	claim: adminProcedure.input(z.object({ uid: z.string() })).mutation(async ({ ctx, input }) => {
		const now = new Date();

		// One claim per admin: release any other applicant they have open.
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

	/** No-op if the claim is held by someone else. */
	releaseClaim: adminProcedure
		.input(z.object({ uid: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.prisma.user.updateMany({
				where: { uid: input.uid, claimedBy: ctx.user.uid },
				data: { claimedBy: null, claimedAt: null }
			});
			return { ok: true };
		}),

	/** Extends the lock. `refreshed: false` means another admin has taken the claim. */
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
	 * Sets a pending decision and releases the claim. The claim guard and the write are
	 * one conditional UPDATE, so there is no window between them.
	 *
	 * Throws:
	 * - TRPCError CONFLICT — another admin holds a fresh claim
	 * - TRPCError NOT_FOUND — no such applicant
	 */
	setDecision: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				// PENDING is a starting state; allowing it lets `release` promote
				// `activeDecision: PENDING` and email nothing.
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
						// Same statement as the decision, so attribution never lands without it.
						decidedBy: ctx.user.uid,
						decidedAt: new Date(),
						claimedBy: null,
						claimedAt: null
					}
				});

				await logAction(ctx, {
					action: 'admissions.decision.set',
					// "Pending", not "accepted": nothing reaches the applicant until release.
					summary: `Set ${applicant.name}'s pending decision to ${input.decision}`,
					target: { id: applicant.uid, label: applicant.name },
					metadata: { decision: input.decision }
				});

				return applicant;
			} catch (e) {
				if (!isRecordNotFound(e)) throw e;

				// Tell "no such applicant" from "locked", and name the holder.
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
	 * Clears a pending decision and its attribution. A released `activeDecision` is
	 * permanent. Same claim CAS as `setDecision`.
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
	 * Scores an applicant and saves the reviewer's notes. Sets no decision: nobody is
	 * accepted or rejected until the queue has been scored and ranked. Same claim CAS as
	 * `setDecision`; re-scoring overwrites, attribution included.
	 *
	 * Inputs:
	 * - notes: string — shown to every admin during the decision pass; blank clears
	 */
	setScore: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
				// The review pane always sends this, blank included, so a note can be deleted.
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
	 * Scores an applicant from the rubric: one picked level per criterion plus a manual
	 * delta. The total is computed here, not trusted from the client, and freezes on
	 * `score` — a later rubric edit changes nothing already saved. Same claim CAS and
	 * attribution as `setScore`; the two writes are alternatives, not layers.
	 *
	 * Throws:
	 * - TRPCError BAD_REQUEST — no rubric defined, or the selections don't cover the
	 *   current rubric exactly (also catches a rubric edited mid-review)
	 */
	setRubricScore: adminProcedure
		.input(
			z.object({
				uid: z.string(),
				selections: z.array(z.object({ criterionId: z.string(), levelId: z.string() })),
				delta: z.number().int().min(-MAX_DELTA).max(MAX_DELTA).default(0),
				notes: z.string().max(5000).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const criteria = await ctx.prisma.rubricCriterion.findMany({
				include: { levels: true }
			});
			if (criteria.length === 0) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No scoring rubric is defined.' });
			}

			const chosen = new Map(input.selections.map((s) => [s.criterionId, s.levelId]));
			if (chosen.size !== criteria.length || input.selections.length !== chosen.size) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'Every rubric criterion needs exactly one selection. The rubric may have changed — reopen it and try again.'
				});
			}

			let subtotal = 0;
			for (const criterion of criteria) {
				const level = criterion.levels.find((l) => l.id === chosen.get(criterion.id));
				if (!level) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'A selected rubric cell no longer exists. The rubric may have changed — reopen it and try again.'
					});
				}
				subtotal += level.points;
			}

			const total = subtotal + input.delta;
			const notes = input.notes?.trim() || null;

			try {
				const applicant = await ctx.prisma.$transaction(async (tx) => {
					const applicant = await tx.user.update({
						where: claimableBy(input.uid, ctx.user.uid),
						data: {
							score: total,
							scoreDelta: input.delta,
							notes,
							scoredBy: ctx.user.uid,
							scoredAt: new Date(),
							claimedBy: null,
							claimedAt: null
						}
					});
					// Replace wholesale: a re-score under an edited rubric must not keep cells
					// for criteria the reviewer no longer picked.
					await tx.rubricSelection.deleteMany({ where: { userId: input.uid } });
					await tx.rubricSelection.createMany({
						data: input.selections.map((s) => ({ userId: input.uid, ...s }))
					});
					return applicant;
				});

				const max = rubricMaxScore(criteria);
				await logAction(ctx, {
					action: 'admissions.score.set',
					summary: `Scored ${applicant.name} ${total}/${max} with the rubric`,
					target: { id: applicant.uid, label: applicant.name },
					metadata: {
						score: total,
						rubricScore: subtotal,
						delta: input.delta,
						hasNotes: notes !== null
					}
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
	 * Sets the same pending decision on many applicants. One statement rather than a
	 * loop over `setDecision`, so a partial failure can't leave the operator guessing
	 * which half landed. Rows under another admin's fresh claim, and non-applicants, are
	 * reported as `skipped` rather than overwritten.
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
					// A stale or hand-edited selection must not put a decision on staff.
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
	 * Headline counts for the admissions page. Decisions are counted at their effective
	 * value (pending if set, else released), matching what the page's list shows.
	 */
	stats: adminProcedure.query(async ({ ctx }) => {
		const applicants = { role: { in: APPLICANT_ROLES }, ...SUBMITTED };

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

			// Cuts across the three above: decisions that exist but aren't emailed yet,
			// which is what the release gate acts on.
			if (row.pendingDecision !== null && row.pendingDecision !== DecisionStatus.PENDING) {
				tally.pending += count;
			}
		}

		// `scored + unscored === undecided`; the decision pass only sees the scored half.
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
				where: { role: { in: APPLICANT_ROLES }, ...SUBMITTED },
				_count: { _all: true }
			}),
			ctx.prisma.user.aggregate({
				where: { role: { in: APPLICANT_ROLES }, ...SUBMITTED, score: { not: null } },
				_avg: { score: true },
				_min: { score: true },
				_max: { score: true },
				_count: { score: true }
			})
		]);

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
	 * Applicants with a released decision, sorted by actionability: waitlisted, rejected,
	 * accepted. Sorted in JS because Prisma has no enum-priority ORDER BY.
	 */
	reconsidering: adminProcedure.query(async ({ ctx }) => {
		const users = await ctx.prisma.user.findMany({
			where: { role: { in: APPLICANT_ROLES }, ...SUBMITTED, activeDecision: { not: null } },
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

	/** Who scored how many applicants and when they last did. */
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
	 * Promotes pending decisions to active and emails each applicant.
	 *
	 * Inputs:
	 * - uids: string[] — restrict to these users; omitted or empty releases every pending
	 *   decision
	 *
	 * Throws:
	 * - TRPCError BAD_REQUEST — nothing to release
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
					// As in `setDecisions`: a hand-edited uid list must not email staff a decision.
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

			// Defaults on an unconfigured install, so a release never decides fates silently.
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

			// Before the transaction, deliberately. Releasing is irreversible, so a template
			// that cannot be rendered has to stop the batch while stopping it is still free —
			// skipping the send afterwards would leave accepted applicants decided and
			// unmailed, which is the one outcome worse than not releasing.
			for (const decision of new Set(users.map((u) => u.pendingDecision))) {
				if (!decision) continue;
				const template = templateMap[decision];
				if (!template?.body) continue;
				const blocked = templateBlockers([template.subject, template.body], mail);
				if (blocked) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `The ${decision.toLowerCase()} email cannot be sent. ${blocked.message}`
					});
				}
			}

			// CAS on the value read above: a decision changed since then is dropped from the
			// batch rather than emailed as a stale, irreversible outcome.
			const swaps = await ctx.prisma.$transaction(
				users.map((u) =>
					ctx.prisma.user.updateMany({
						where: { uid: u.uid, pendingDecision: u.pendingDecision },
						data: {
							activeDecision: u.pendingDecision,
							pendingDecision: null,
							// `decidedBy`/`decidedAt` untouched: release publishes other admins' work.
							claimedBy: null,
							claimedAt: null
						}
					})
				)
			);

			const releasedUsers = users.filter((_, i) => swaps[i].count === 1);

			const recipients = releasedUsers.filter(
				(u) => u.pendingDecision && templateMap[u.pendingDecision].body
			);
			const emailsAttempted = recipients.length;

			const results = await Promise.allSettled(
				recipients.map(async (u) => {
					// Raw row, not `mail`: the wallet gate must fail closed on an unconfigured
					// install. See buildEmailPersonalization.
					const { vars, attachments } = await buildEmailPersonalization(u, settings);
					return sendTemplatedEmail(u.email, templateMap[u.pendingDecision!], vars, attachments);
				})
			);
			const emailsFailed = results.filter((r) => r.status === 'rejected').length;

			// The one irreversible batch action, so the entry carries the full breakdown.
			const byDecision: Record<string, number> = {};
			for (const u of releasedUsers) {
				const key = u.pendingDecision ?? 'none';
				byDecision[key] = (byDecision[key] ?? 0) + 1;
			}

			// Rows whose decision moved between read and swap; surfaced, not silently fewer.
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
