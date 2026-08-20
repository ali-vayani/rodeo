/**
 * DEV ONLY. Pure helpers for the account switcher widget.
 *
 * Kept out of the `.svelte` file because vitest has one project here (node, no DOM), so
 * a plain module is testable and a component is not. Enums are imported as types from
 * the generated `enums` module: the client barrel runs `fileURLToPath` at module load
 * and 500s hydration.
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

/**
 * An account plus the values the panel would otherwise recompute on every keystroke:
 * a lowercased search haystack, and the two sort keys.
 */
export interface IndexedAccount extends DevAccount {
	haystack: string;
	rank: number;
	seq: number;
}

/**
 * Sort order for the panel. Staff first, descending by access, then the population the
 * app is actually about.
 */
const ROLE_RANK: Role[] = [
	'ADMIN',
	'ORGANIZER',
	'JUDGE',
	'MENTOR',
	'VOLUNTEER',
	'HACKER',
	'UNDECLARED'
] as Role[];

/** Trailing integer of a seeded address — `hacker42@yopmail.com` → 42. */
function emailSequence(email: string): number {
	const match = /(\d+)@/.exec(email);
	return match ? Number(match[1]) : 0;
}

/**
 * Attach the derived fields once, at fetch time. The haystack folds in the role name,
 * so typing `judge` filters to judges without touching a filter chip.
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
 * Role rank, then the numeric suffix. Plain lexicographic ordering puts `hacker100`
 * between `hacker1` and `hacker2`, which makes a 120-row list unreadable.
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
 * The synthetic "no decision recorded" option, spelled like `NO_DECISION` in
 * `$lib/admin/filters` so both decision filters agree on what a null column is called.
 * Not imported from there, which pulls the enums in as values.
 */
export const NO_DECISION = 'NONE';

/** A decision column's value, with null spelled out so it can be a chip. */
export type DecisionFilterValue = DecisionStatus | typeof NO_DECISION;

/**
 * Chip order for both decision groups: outcomes first, then the two flavours of "not
 * decided". Alphabetical would put Accepted next to Rejected and bury Waitlisted.
 */
const DECISION_RANK: DecisionFilterValue[] = [
	'ACCEPTED',
	'WAITLISTED',
	'REJECTED',
	'PENDING',
	NO_DECISION
] as DecisionFilterValue[];

/** The two decision columns, named so a caller can't mix them up positionally. */
export type DecisionField = 'activeDecision' | 'pendingDecision';

/** A row's value for one decision column, with null folded to `NO_DECISION`. */
export function decisionValue(account: DevAccount, field: DecisionField): DecisionFilterValue {
	return account[field] ?? (NO_DECISION as DecisionFilterValue);
}

/** The chips worth offering for one decision column: only values some row has, so a
    seed that created no rejections does not show a dead Rejected chip. */
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
	/** Matches `activeDecision` — the decision the applicant can actually see. */
	decisions?: readonly DecisionFilterValue[];
	/** Matches `pendingDecision` — decided by a reviewer but not yet released. */
	pendingDecisions?: readonly DecisionFilterValue[];
}

/**
 * Search AND role AND status AND each decision column; within a group, OR. An empty
 * selection means "no filter", matching `buildRecipientParams`.
 *
 * The two decision columns are separate groups, never merged. A released ACCEPTED next
 * to a held REJECTED is exactly the fixture you open this widget to find.
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
 * Read the persisted position, or null for the default corner. Every failure funnels to
 * null: this widget mounts on every page, and `getItem` throws in Safari private mode.
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

export function savePosition(storage: Pick<Storage, 'setItem'>, pos: Position): void {
	try {
		storage.setItem(POSITION_KEY, JSON.stringify({ v: POSITION_VERSION, x: pos.x, y: pos.y }));
	} catch {
		// Where the button sits is a convenience and never worth an exception.
	}
}

/**
 * Keep the button on screen. Called while dragging, when restoring a stored position,
 * on resize and from the reset control, which is what makes "I dragged it off the edge"
 * unreachable rather than merely unlikely.
 *
 * `Math.max` on the upper bound handles a viewport narrower than the button itself,
 * where the clamp would otherwise invert and pin it to a negative coordinate.
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
 * Why the filters are persisted at all. Switching account is a full `location.assign`,
 * which remounts this component, so a search and four chip selections were thrown away
 * by the one action the panel exists to perform.
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

/** Strings only, and only strings — anything else in the array is dropped. */
function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Read the persisted filters, always returning a usable object. Every failure funnels
 * to the empty set, like `loadPosition`.
 *
 * Values are not validated against the current enums: a filter naming a role that no
 * longer exists matches nothing and is one click of Clear away, where dropping the
 * whole record loses the other four.
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

export function saveFilters(storage: Pick<Storage, 'setItem'>, filters: StoredFilters): void {
	try {
		storage.setItem(FILTERS_KEY, JSON.stringify({ v: FILTERS_VERSION, ...filters }));
	} catch {
		// Same as savePosition: a convenience, never worth an exception.
	}
}
