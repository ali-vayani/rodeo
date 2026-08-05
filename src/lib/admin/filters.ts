import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';

/**
 * Shared checkbox-filter vocabulary and the translation from checkbox state to
 * tRPC filter params.
 *
 * The Users page and the custom-email wizard both drive `buildRecipientWhere` on
 * the server, so they must agree on what "all checked" and "none checked" mean —
 * otherwise a count from one and a send from the other disagree.
 */
// Kept as the enum types, not widened to string[]. Widening them was the single
// cause of the `as any` at every tRPC call site downstream: the params these
// build feed procedures whose input schemas are the enums.
export const ALL_ROLES: Role[] = Object.values(Role);
export const ALL_STATUSES: UserStatus[] = Object.values(UserStatus);
export const DECISION_VALUES: DecisionStatus[] = Object.values(DecisionStatus);

/** Synthetic option for users with no `activeDecision` yet. Not a DecisionStatus. */
export const NO_DECISION = 'NONE';
export const DECISION_OPTIONS: string[] = [...DECISION_VALUES, NO_DECISION];

export type FilterState = Record<string, boolean>;

/** Every option checked — the default, meaning "no filter applied". */
export function allChecked(options: readonly string[]): FilterState {
	return Object.fromEntries(options.map((o) => [o, true]));
}

export type RecipientParams = {
	search?: string;
	roles?: Role[];
	statuses?: UserStatus[];
	decisions?: DecisionStatus[];
	includeNoDecision?: boolean;
	emails?: string[];
};

/**
 * Split a pasted blob into addresses. Accepts commas, semicolons, whitespace and
 * newlines, so a column copied out of a spreadsheet works as-is.
 *
 * Lowercased to match how the login flow stores addresses, and deduplicated so a
 * repeated address doesn't imply a repeated send.
 */
export function parseEmailList(raw: string): string[] {
	const seen = new Set<string>();
	for (const part of raw.split(/[,;\s]+/)) {
		const email = part.trim().toLowerCase();
		if (email) seen.add(email);
	}
	return [...seen];
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Entries that aren't shaped like an address at all — caught before hitting the DB. */
export function malformedEmails(emails: string[]): string[] {
	return emails.filter((e) => !EMAIL_SHAPE.test(e));
}

/**
 * Translate checkbox state into tRPC filter params.
 *
 * Everything checked → the key is omitted, so the server skips that filter.
 * Nothing checked in the decision group → `decisions: []` plus
 * `includeNoDecision: false`, which `buildRecipientWhere` reads as "match nothing".
 * That asymmetry is deliberate and is what stops a "0 recipients" display from
 * turning into a send to the entire database.
 */
export function buildRecipientParams(
	roleFilter: FilterState,
	statusFilter: FilterState,
	decisionFilter: FilterState,
	search = ''
): RecipientParams {
	const selRoles = ALL_ROLES.filter((r) => roleFilter[r]);
	const selStatuses = ALL_STATUSES.filter((s) => statusFilter[s]);
	const selDecisions = DECISION_VALUES.filter((d) => decisionFilter[d]);
	const noneChecked = decisionFilter[NO_DECISION] ?? true;
	const allDecisionsDefault = selDecisions.length === DECISION_VALUES.length && noneChecked;

	return {
		search: search.trim() || undefined,
		roles: selRoles.length < ALL_ROLES.length ? selRoles : undefined,
		statuses: selStatuses.length < ALL_STATUSES.length ? selStatuses : undefined,
		decisions: allDecisionsDefault ? undefined : selDecisions,
		includeNoDecision: allDecisionsDefault ? undefined : noneChecked
	};
}
