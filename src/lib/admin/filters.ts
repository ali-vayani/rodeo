import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
import { LINKED_FIELDS, type LinkedField } from '$lib/linkedFields';

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
export type LinkedSelection = Partial<Record<LinkedField, string[]>>;

/**
 * Linked field → the plural wire key `recipientFilterSchema` accepts for it.
 *
 * These keys are also the query parameters in a shared filter link, so they stay as
 * they are. Renaming them alongside the enum would have broken every link anyone had
 * already sent, to buy nothing.
 */
const LINKED_PARAM_KEY = {
	NAME: 'names',
	UNIVERSITY: 'universities',
	YEAR: 'years'
} as const satisfies Record<LinkedField, keyof LinkedParams>;

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
	for (const field of LINKED_FIELDS) {
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
 * Everything checked → the key is omitted, so the server skips that filter.
 * Nothing checked in the decision group → `decisions: []` plus
 * `includeNoDecision: false`, which `buildRecipientWhere` reads as "match nothing".
 * That asymmetry is deliberate and is what stops a "0 recipients" display from
 * turning into a send to the entire database.
 *
 * The linked application fields come through `linkedParams`, which encodes the same
 * omitted-vs-empty convention from the other end — see its note.
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

	return {
		search: search.trim() || undefined,
		roles: selRoles.length < ALL_ROLES.length ? selRoles : undefined,
		statuses: selStatuses.length < ALL_STATUSES.length ? selStatuses : undefined,
		decisions: allDecisionsDefault ? undefined : selDecisions,
		includeNoDecision: allDecisionsDefault ? undefined : noneChecked,
		...linkedParams(linked)
	};
}
