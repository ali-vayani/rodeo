/**
 * DEV ONLY. Pure helpers for the account switcher, kept out of the `.svelte` file so
 * vitest (node, no DOM) can test them. Enums are type-only imports from `enums`: the
 * client barrel runs `fileURLToPath` at module load and 500s hydration.
 */

import type { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';

/** Mirrors `DEV_ACCOUNT_SELECT` in `src/routes/dev/accounts/+server.ts`. */
export interface DevAccount {
	uid: string;
	name: string;
	email: string;
	role: Role;
	status: UserStatus;
	activeDecision: DecisionStatus | null;
	pendingDecision: DecisionStatus | null;
}

/** An account plus the search haystack and sort keys, computed once at fetch time. */
export interface IndexedAccount extends DevAccount {
	haystack: string;
	rank: number;
	seq: number;
}

/** Staff first, descending by access. */
const ROLE_RANK: Role[] = [
	'ADMIN',
	'ORGANIZER',
	'JUDGE',
	'MENTOR',
	'VOLUNTEER',
	'HACKER',
	'UNDECLARED'
] as Role[];

/** `hacker42@yopmail.com` -> 42. */
function emailSequence(email: string): number {
	const match = /(\d+)@/.exec(email);
	return match ? Number(match[1]) : 0;
}

/**
 * Attaches the derived fields. The haystack folds in the role name, so typing `judge`
 * filters to judges without a chip.
 *
 * Inputs:
 * - accounts: readonly DevAccount[]
 *
 * Outputs:
 * - IndexedAccount[] — same order as the input
 */
export function indexAccounts(accounts: readonly DevAccount[]): IndexedAccount[] {
	return accounts.map((account) => ({
		...account,
		haystack: `${account.name} ${account.email} ${account.role}`.toLowerCase(),
		rank: ROLE_RANK.indexOf(account.role),
		seq: emailSequence(account.email)
	}));
}

/**
 * Role rank, then numeric email suffix: lexicographic order puts `hacker100` between
 * `hacker1` and `hacker2`.
 *
 * Outputs:
 * - IndexedAccount[] — a new array; the input is not mutated
 */
export function sortAccounts(accounts: readonly IndexedAccount[]): IndexedAccount[] {
	return [...accounts].sort(
		(a, b) => a.rank - b.rank || a.seq - b.seq || a.email.localeCompare(b.email)
	);
}

// ---------------------------------------------------------------------------
// Decision filters
// ---------------------------------------------------------------------------

/**
 * Spelled like `NO_DECISION` in `$lib/admin/filters` but not imported from there, which
 * would pull the enums in as values.
 */
export const NO_DECISION = 'NONE';

/** A decision column's value, with null spelled out so it can be a chip. */
export type DecisionFilterValue = DecisionStatus | typeof NO_DECISION;

/** Outcomes first, then the two flavours of "not decided". */
const DECISION_RANK: DecisionFilterValue[] = [
	'ACCEPTED',
	'WAITLISTED',
	'REJECTED',
	'PENDING',
	NO_DECISION
] as DecisionFilterValue[];

export type DecisionField = 'activeDecision' | 'pendingDecision';

/** A row's value for one decision column, with null folded to `NO_DECISION`. */
export function decisionValue(account: DevAccount, field: DecisionField): DecisionFilterValue {
	return account[field] ?? (NO_DECISION as DecisionFilterValue);
}

/**
 * Chips for one decision column: only values some row has, in `DECISION_RANK` order.
 *
 * Inputs:
 * - accounts: readonly DevAccount[]
 * - field: DecisionField — which column to read
 *
 * Outputs:
 * - DecisionFilterValue[] — empty when `accounts` is empty
 */
export function decisionOptions(
	accounts: readonly DevAccount[],
	field: DecisionField
): DecisionFilterValue[] {
	const present = new Set(accounts.map((account) => decisionValue(account, field)));
	return DECISION_RANK.filter((value) => present.has(value));
}

export interface AccountFilters {
	query?: string;
	roles?: readonly Role[];
	statuses?: readonly UserStatus[];
	/** Matches `activeDecision`, the released decision. */
	decisions?: readonly DecisionFilterValue[];
	/** Matches `pendingDecision`, decided but not yet released. */
	pendingDecisions?: readonly DecisionFilterValue[];
}

/**
 * AND across groups and the query; OR within a group. An empty selection means no
 * filter, matching `buildRecipientParams`. The two decision columns are never merged:
 * a released ACCEPTED beside a held REJECTED is the fixture this widget exists to find.
 *
 * Inputs:
 * - accounts: readonly IndexedAccount[]
 * - filters: AccountFilters — query is trimmed and case-folded
 *
 * Outputs:
 * - IndexedAccount[] — input order preserved
 */
export function filterAccounts(
	accounts: readonly IndexedAccount[],
	filters: AccountFilters = {}
): IndexedAccount[] {
	const query = filters.query?.trim().toLowerCase() ?? '';
	const roles = filters.roles ?? [];
	const statuses = filters.statuses ?? [];
	const decisions = filters.decisions ?? [];
	const pendingDecisions = filters.pendingDecisions ?? [];

	return accounts.filter((account) => {
		if (roles.length && !roles.includes(account.role)) return false;
		if (statuses.length && !statuses.includes(account.status)) return false;
		if (decisions.length && !decisions.includes(decisionValue(account, 'activeDecision'))) {
			return false;
		}
		if (
			pendingDecisions.length &&
			!pendingDecisions.includes(decisionValue(account, 'pendingDecision'))
		) {
			return false;
		}
		return !query || account.haystack.includes(query);
	});
}

// ---------------------------------------------------------------------------
// Button position
// ---------------------------------------------------------------------------

export interface Position {
	x: number;
	y: number;
}

export interface Size {
	w: number;
	h: number;
}

export const POSITION_KEY = 'rodeo:dev-switcher:position';

/** Bumped if the stored shape changes, so a stale record resets rather than throws. */
const POSITION_VERSION = 1;

/**
 * Reads the persisted position. Every failure funnels to null: this widget mounts on
 * every page, and `getItem` throws in Safari private mode.
 *
 * Outputs:
 * - Position | null — null means the default corner
 */
export function loadPosition(storage: Pick<Storage, 'getItem'>): Position | null {
	try {
		const raw = storage.getItem(POSITION_KEY);
		if (!raw) return null;

		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;

		const { v, x, y } = parsed as { v?: unknown; x?: unknown; y?: unknown };
		if (v !== POSITION_VERSION) return null;
		if (typeof x !== 'number' || typeof y !== 'number') return null;
		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

		return { x, y };
	} catch {
		return null;
	}
}

/** Never throws: the button's position is a convenience. */
export function savePosition(storage: Pick<Storage, 'setItem'>, pos: Position): void {
	try {
		storage.setItem(POSITION_KEY, JSON.stringify({ v: POSITION_VERSION, x: pos.x, y: pos.y }));
	} catch {
		// Quota or private mode.
	}
}

/**
 * Keeps the button on screen. `Math.max` on the upper bound handles a viewport narrower
 * than the button, where the clamp would otherwise invert to a negative coordinate.
 *
 * Inputs:
 * - pos: Position — candidate position
 * - viewport: Size, size: Size, margin: number — px
 *
 * Outputs:
 * - Position — within `[margin, viewport - size - margin]` on each axis
 */
export function clampPosition(pos: Position, viewport: Size, size: Size, margin: number): Position {
	const maxX = Math.max(margin, viewport.w - size.w - margin);
	const maxY = Math.max(margin, viewport.h - size.h - margin);
	return {
		x: Math.min(Math.max(pos.x, margin), maxX),
		y: Math.min(Math.max(pos.y, margin), maxY)
	};
}

// ---------------------------------------------------------------------------
// Panel filters
// ---------------------------------------------------------------------------

/**
 * Persisted because switching account is a full `location.assign`, which would
 * otherwise throw the filters away.
 */
export const FILTERS_KEY = 'rodeo:dev-switcher:filters';

/** Bumped if the stored shape changes, so a stale record resets rather than throws. */
const FILTERS_VERSION = 1;

export interface StoredFilters {
	query: string;
	roles: string[];
	statuses: string[];
	decisions: string[];
	pendingDecisions: string[];
}

const EMPTY_FILTERS: StoredFilters = {
	query: '',
	roles: [],
	statuses: [],
	decisions: [],
	pendingDecisions: []
};

/** Non-string entries are dropped; a non-array yields []. */
function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Reads the persisted filters. Every failure funnels to the empty set, like
 * `loadPosition`. Values are not validated against the current enums: a stale role
 * matches nothing and is one click of Clear away, where dropping the record loses the
 * other four filters.
 *
 * Outputs:
 * - StoredFilters — always a fresh, usable object
 */
export function loadFilters(storage: Pick<Storage, 'getItem'>): StoredFilters {
	try {
		const raw = storage.getItem(FILTERS_KEY);
		if (!raw) return { ...EMPTY_FILTERS };

		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_FILTERS };

		const record = parsed as Record<string, unknown>;
		if (record.v !== FILTERS_VERSION) return { ...EMPTY_FILTERS };

		return {
			query: typeof record.query === 'string' ? record.query : '',
			roles: stringList(record.roles),
			statuses: stringList(record.statuses),
			decisions: stringList(record.decisions),
			pendingDecisions: stringList(record.pendingDecisions)
		};
	} catch {
		return { ...EMPTY_FILTERS };
	}
}

/** Never throws, like `savePosition`. */
export function saveFilters(storage: Pick<Storage, 'setItem'>, filters: StoredFilters): void {
	try {
		storage.setItem(FILTERS_KEY, JSON.stringify({ v: FILTERS_VERSION, ...filters }));
	} catch {
		// Quota or private mode.
	}
}
