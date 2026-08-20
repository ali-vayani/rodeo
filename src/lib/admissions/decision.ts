/**
 * What decision an applicant actually stands at.
 */
export function effectiveDecision<T extends string>(row: {
	pendingDecision: T | null;
	activeDecision: T | null;
}): T | null {
	const pending = row.pendingDecision === 'PENDING' ? null : row.pendingDecision;
	return pending ?? row.activeDecision;
}
