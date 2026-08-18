/**
 * What decision an applicant actually stands at.
 *
 * Isomorphic on purpose, like `$lib/stats` and `$lib/admissions/score`: the
 * admissions router folds its stats with this and the queue, the ranked list and
 * the detail pane all render chips from it. One definition is the point — a
 * badge saying "Pending" over a row the server counts as undecided is exactly
 * the kind of drift two copies produce.
 *
 * `PENDING` is the enum's starting value, not a verdict: `setDecision` refuses
 * to write it, `release` emails nothing for it, and the seed writes it to mean
 * "in the queue, untouched". So it reads as no decision, and an applicant
 * carrying it falls through to whatever was already released.
 *
 * Compared against the literal rather than the generated enum so this stays free
 * of Prisma imports; `DecisionStatus.PENDING` is that string.
 */
export function effectiveDecision<T extends string>(row: {
	pendingDecision: T | null;
	activeDecision: T | null;
}): T | null {
	const pending = row.pendingDecision === 'PENDING' ? null : row.pendingDecision;
	return pending ?? row.activeDecision;
}
