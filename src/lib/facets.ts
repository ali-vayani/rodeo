/**
 * The filter vocabulary for application answers, and the contract the panels render.
 *
 * One facet is one filterable thing an applicant told us: a question that writes
 * through to a `User` column (`linked:UNIVERSITY`), any other question on the form
 * (`question:<id>`), or something derived from those (`state`). The three kinds share
 * this contract precisely so the panel never branches on which kind it is holding —
 * it branches on `control`, which is chosen from the question's own type.
 *
 * Deliberately isomorphic. Imported by the filter UI (browser) and by the routers that
 * build the Prisma predicate (server), so keep it free of Prisma, node builtins and
 * `$env`. The Prisma import below is `import type`, which erases at build.
 */

import type { LinkedField } from '$lib/generated/prisma/client';

/**
 * How a facet is rendered, derived from the question's `type` — never from its name.
 *
 * `select`   — the question enumerates its answers (`DROPDOWN`, `MULTIPLE_CHOICE`,
 *              `CHECKBOX`), so its options are authoritative and a checkbox list can
 *              show the whole vocabulary at once.
 * `combobox` — free text with a bounded observed vocabulary (a preset-backed question,
 *              or a linked column). No authoritative list, so it needs type-ahead.
 * `search`   — free text with no useful vocabulary at all. A substring box, because a
 *              list of what 1,800 people typed into "Why do you want to attend?" is a
 *              transcript, not a filter.
 * `range`    — numeric. Two bounds, because "under 21" is the question people ask of a
 *              number and no checkbox list expresses it.
 */
export type FacetControl = 'select' | 'combobox' | 'search' | 'range';

export interface FacetOption {
	/** Verbatim stored answer. Never the empty string — see `noneCount`. */
	value: string;
	/** Shown instead of `value` when the raw answer isn't what a reader should see. */
	label?: string;
	/** How many users currently hold it. Shown so near-duplicate values are visible. */
	count: number;
}

export interface Facet {
	/** Opaque to the UI; the server and `$lib/admin/filters` both read it via `parseFacetKey`. */
	key: string;
	/** The question's own title, so the filter is labelled the way the form asks. */
	label: string;
	control: FacetControl;
	/** `select` and `combobox` only; empty for `search` and `range`. */
	options: FacetOption[];
	/** Users with no answer, selectable via `NO_VALUE`. */
	noneCount: number;
	/**
	 * The option list was cut at `MAX_FACET_OPTIONS`; rarer values are missing.
	 *
	 * Only ever set on a `combobox`, whose vocabulary is unbounded by construction. The
	 * UI must say so rather than implying a value doesn't exist: the predicate still
	 * accepts any value, and the search box is how someone finds one that isn't listed.
	 */
	truncated?: boolean;
	/** `range` only: the observed extent, used to caption the two inputs. */
	bounds?: { min: number; max: number };
}

/**
 * What one facet's controls hold. Every key is independently optional because the
 * controls are: a `range` sets `min`/`max`, a `search` sets `contains`, the other two
 * set `values`.
 */
export interface FacetSelection {
	values?: string[];
	contains?: string;
	min?: number;
	max?: number;
}

/** The whole panel's state, keyed by `Facet.key`. */
export type FacetState = Record<string, FacetSelection>;

/**
 * Most options a facet returns.
 *
 * Applies to `combobox` facets only — a `select`'s list is bounded by the question that
 * declares it. Kept most-held-first, so what survives the cut is the part of the
 * vocabulary a filter is actually used on.
 */
export const MAX_FACET_OPTIONS = 500;

/**
 * Selects users whose answer to a facet is absent.
 *
 * "Who hasn't filled this in" is a question organizers actually ask, and roughly a
 * third of seeded users have no university. A sentinel rather than a per-facet boolean
 * keeps the wire format one array per facet, so the engaged-but-empty rule applies
 * uniformly.
 *
 * Printable and URL-safe on purpose. This was briefly a NUL byte, on the reasoning that
 * no real answer could contain one — true, but it also cannot survive the places a
 * filter selection legitimately travels: Postgres `text` rejects NUL outright, and
 * `%00` in a query string is refused by some proxies and by Node's URL parsing.
 */
export const NO_VALUE = '__NO_VALUE__';

/**
 * The state facet's second row, and its whole reason for existing.
 *
 * The facet is exactly two options — the home state from Settings, and this. "Are they
 * from Texas or not" is the question an organizer asks of an applicant pool, because it
 * drives catering, travel reimbursement and housing; "which of the fifty states" is not.
 * Only offered when a home state is configured, since without one there is no "out" to
 * be out of, and a facet that is half a pair is no facet.
 */
export const OUT_OF_STATE = '__OUT_OF_STATE__';

/**
 * A university we can place, outside the US.
 *
 * An internal bucket key, never an offered option: international applicants are counted
 * inside `OUT_OF_STATE`, since someone flying in from Toronto is no less
 * not-from-Texas than someone driving from Atlanta. Exported because
 * `$lib/server/homeState` keys its tally map on it.
 */
export const INTERNATIONAL = '__INTERNATIONAL__';

/** The state facet's key. There is exactly one, so it needs no discriminator. */
export const STATE_FACET_KEY = 'state';

export function linkedFacetKey(field: LinkedField): string {
	return `linked:${field}`;
}

export function questionFacetKey(questionId: string): string {
	return `question:${questionId}`;
}

/**
 * A facet key, taken apart.
 *
 * The panel never calls this — it treats keys as opaque. The two ends that do are the
 * client's params builder and the server's predicate builder, and they must agree, so
 * the parsing lives here rather than as a `split(':')` at each of them.
 */
export type ParsedFacetKey =
	| { kind: 'linked'; field: LinkedField }
	| { kind: 'question'; questionId: string }
	| { kind: 'state' };

export function parseFacetKey(key: string): ParsedFacetKey | null {
	if (key === STATE_FACET_KEY) return { kind: 'state' };
	const separator = key.indexOf(':');
	if (separator < 0) return null;
	const prefix = key.slice(0, separator);
	const rest = key.slice(separator + 1);
	if (!rest) return null;
	// A question id is a cuid, which cannot contain a colon, so the split is unambiguous.
	if (prefix === 'question') return { kind: 'question', questionId: rest };
	if (prefix === 'linked') return { kind: 'linked', field: rest as LinkedField };
	return null;
}

/**
 * Split a selection into concrete values plus whether "no value" was chosen.
 *
 * Shared by the predicate builder and the UI so both read the sentinel the same way.
 */
export function splitNoValue(selected: readonly string[]): {
	values: string[];
	includeNone: boolean;
} {
	const values = selected.filter((v) => v !== NO_VALUE);
	return { values, includeNone: selected.includes(NO_VALUE) };
}

/** Whether a facet is currently narrowing anything. Drives the panel's count badges. */
export function isEngaged(selection: FacetSelection | undefined): boolean {
	if (!selection) return false;
	return Boolean(
		selection.values?.length ||
		selection.contains?.trim() ||
		selection.min !== undefined ||
		selection.max !== undefined
	);
}
