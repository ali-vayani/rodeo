/**
 * The decision an applicant currently stands at: an unreleased pending decision wins
 * over the released one. `PENDING` is the "no pending decision" marker, so it falls
 * through to `activeDecision` rather than masking it.
 *
 * Outputs:
 * - T | null — null when neither column holds a decision
 */
export function effectiveDecision<T extends string>(row: {
	pendingDecision: T | null;
	activeDecision: T | null;
}): T | null {
	const pending = row.pendingDecision === 'PENDING' ? null : row.pendingDecision;
	return pending ?? row.activeDecision;
}
