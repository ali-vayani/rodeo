import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
import { LINKED_USER_FIELDS, type LinkedUserField } from '$lib/linkedFields';

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

/** The wire keys for the linked application fields, mirroring `linkedFieldFilterSchema`. */
export type LinkedParams = {
	names?: string[];
	universities?: string[];
	years?: string[];
};

export type RecipientParams = {
	search?: string;
	roles?: Role[];
	statuses?: UserStatus[];
	decisions?: DecisionStatus[];
	includeNoDecision?: boolean;
	emails?: string[];
} & LinkedParams;

/** What `LinkedFieldFilters` binds: chosen values per field, `NO_VALUE` included. */
export type LinkedSelection = Partial<Record<LinkedUserField, string[]>>;

/** `User` column → the plural wire key `recipientFilterSchema` accepts for it. */
const LINKED_PARAM_KEY = {
	name: 'names',
	university: 'universities',
	year: 'years'
} as const satisfies Record<LinkedUserField, keyof LinkedParams>;

/**
 * Translate a linked-field selection into tRPC filter params.
 *
 * **A field with nothing selected must be omitted, never sent as `[]`.** The two are
 * opposite instructions to the shared predicate: `$lib/server/recipients` reads an
 * absent key as "no filter" and an empty array as "match nobody", because a checkbox
 * group the admin engaged and then emptied means "show nobody". Every one of these
 * controls starts empty, so sending `[]` for an untouched filter would make the Users
 * page show zero rows and — through that same predicate — make the custom-email count
 * read 0 while the wizard still offers to send.
 *
 * The asymmetry with the role/status/decision groups is real and is a property of the
 * controls, not an inconsistency: those default to *all* checked, so "no filter" is a
 * full selection, while these default to *none* checked, so "no filter" is an empty
 * one. Both end up as an omitted key, which is the only thing the server sees.
 */
export function linkedParams(selected: LinkedSelection = {}): LinkedParams {
	const params: LinkedParams = {};
	for (const field of LINKED_USER_FIELDS) {
		const values = selected[field];
		// Copied, not aliased: these params travel to a tRPC call while the caller's
		// state keeps mutating under the filter panel.
		if (values && values.length > 0) params[LINKED_PARAM_KEY[field]] = [...values];
	}
	return params;
}

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
 * One rule for every group: a key is sent only while it is *narrowing*. Everything
 * ticked → omitted, since that selects everyone anyway. Nothing ticked → omitted too:
 * a group selecting none of its options has stopped filtering, not asked for nobody.
 * The panels' `clear` buttons reset a group to all ticked, so all-unticked is only
 * reachable by hand — but it must still not empty the table.
 *
 * The second half was false for the decision group alone, which sent `decisions: []`
 * plus `includeNoDecision: false` — and `$lib/server/recipients` reads an empty array
 * as match-nobody. So clearing Decision emptied the Users table, and clearing the panel
 * and then ticking a single role left it empty, since the poisoned decision clause
 * ANDed with everything else. Role and status already behaved correctly; decision now
 * agrees with them.
 *
 * That leaves engaged-but-empty to the two places whose controls start *empty* and so
 * genuinely need it — the explicit address list and the linked application fields; see
 * `linkedParams`, which omits an untouched key for the same reason from the other end.
 *
 * Mailing the whole database is prevented where it can actually be prevented:
 * `email.sendCustom` binds a send to the `expectedCount` the admin previewed and
 * refuses when the resolved set has moved.
 */
export function buildRecipientParams(
	roleFilter: FilterState,
	statusFilter: FilterState,
	decisionFilter: FilterState,
	search = '',
	linked: LinkedSelection = {}
): RecipientParams {
	const selRoles = ALL_ROLES.filter((r) => roleFilter[r]);
	const selStatuses = ALL_STATUSES.filter((s) => statusFilter[s]);
	const selDecisions = DECISION_VALUES.filter((d) => decisionFilter[d]);
	const noneChecked = decisionFilter[NO_DECISION] ?? true;
	const allDecisionsDefault = selDecisions.length === DECISION_VALUES.length && noneChecked;

	// Narrowing means: some options ticked, but not all of them. The `NONE` pseudo-option
	// counts as a decision selection, so unticking only it still narrows.
	const rolesNarrow = selRoles.length > 0 && selRoles.length < ALL_ROLES.length;
	const statusesNarrow = selStatuses.length > 0 && selStatuses.length < ALL_STATUSES.length;
	const decisionsNarrow = (selDecisions.length > 0 || noneChecked) && !allDecisionsDefault;

	return {
		search: search.trim() || undefined,
		roles: rolesNarrow ? selRoles : undefined,
		statuses: statusesNarrow ? selStatuses : undefined,
		decisions: decisionsNarrow ? selDecisions : undefined,
		includeNoDecision: decisionsNarrow ? noneChecked : undefined,
		...linkedParams(linked)
	};
}
