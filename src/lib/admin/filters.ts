import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
import type { LinkedField } from '$lib/linkedFields';
import { isEngaged, parseFacetKey, type FacetState } from '$lib/facets';

export const ALL_ROLES: Role[] = Object.values(Role);
export const ALL_STATUSES: UserStatus[] = Object.values(UserStatus);
export const DECISION_VALUES: DecisionStatus[] = Object.values(DecisionStatus);

export const NO_DECISION = 'NONE';
export const DECISION_OPTIONS: string[] = [...DECISION_VALUES, NO_DECISION];

export type FilterState = Record<string, boolean>;

/** Every option checked — the default, meaning "no filter applied". */
export function allChecked(options: readonly string[]): FilterState {
	return Object.fromEntries(options.map((o) => [o, true]));
}

export type LinkedParams = {
	names?: string[];
	universities?: string[];
	years?: string[];
};

export type AnswerParam = {
	questionId: string;
	values?: string[];
	contains?: string;
	min?: number;
	max?: number;
};

export type AnswerParams = {
	answers?: AnswerParam[];
	states?: string[];
};

export type RecipientParams = {
	search?: string;
	roles?: Role[];
	statuses?: UserStatus[];
	decisions?: DecisionStatus[];
	includeNoDecision?: boolean;
	emails?: string[];
} & LinkedParams &
	AnswerParams;

const LINKED_PARAM_KEY = {
	NAME: 'names',
	UNIVERSITY: 'universities',
	YEAR: 'years'
} as const satisfies Record<LinkedField, keyof LinkedParams>;

export function facetParams(selection: FacetState = {}): LinkedParams & AnswerParams {
	const params: LinkedParams & AnswerParams = {};
	const answers: AnswerParam[] = [];

	for (const [key, chosen] of Object.entries(selection)) {
		if (!chosen || !isEngaged(chosen)) continue;
		const parsed = parseFacetKey(key);
		if (!parsed) continue;

		if (parsed.kind === 'linked') {
			// Copied, not aliased: these params travel to a tRPC call while the caller's
			// state keeps mutating under the filter panel.
			if (chosen.values?.length) params[LINKED_PARAM_KEY[parsed.field]] = [...chosen.values];
			continue;
		}

		if (parsed.kind === 'state') {
			if (chosen.values?.length) params.states = [...chosen.values];
			continue;
		}

		const entry: AnswerParam = { questionId: parsed.questionId };
		if (chosen.values?.length) entry.values = [...chosen.values];
		const term = chosen.contains?.trim();
		if (term) entry.contains = term;
		if (chosen.min !== undefined) entry.min = chosen.min;
		if (chosen.max !== undefined) entry.max = chosen.max;
		answers.push(entry);
	}

	if (answers.length) params.answers = answers;
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
 * Translate checkbox state into tRPC filter params..
 */
export function buildRecipientParams(
	roleFilter: FilterState,
	statusFilter: FilterState,
	decisionFilter: FilterState,
	search = '',
	facets: FacetState = {}
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
		...facetParams(facets)
	};
}
