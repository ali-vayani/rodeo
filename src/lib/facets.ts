/**
 * The filter vocabulary for application answers, and the contract the panels render.
 *
 * One facet is one filterable thing an applicant told us: a linked `User` column, any
 * other question on the form, or something derived from those. The three kinds share
 * this contract so the panel branches on `control`, never on which kind it holds.
 *
 * Isomorphic, so keep it free of Prisma, node builtins and `$env`.
 */

import type { LinkedField } from '$lib/generated/prisma/client';

/**
 * How a facet is rendered, derived from the question's `type`.
 *
 * `select`   — the question enumerates its answers, so its options are authoritative.
 * `combobox` — free text with a bounded observed vocabulary; needs type-ahead.
 * `search`   — free text with no useful vocabulary, so a substring box.
 * `range`    — numeric, two bounds, because "under 21" is what people ask of a number.
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
	 * The option list was cut at `MAX_FACET_OPTIONS`; rarer values are missing. Only ever
	 * set on a `combobox`. The predicate still accepts any value, and the search box
	 * finds what is not listed.
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
 * Most options a facet returns. `combobox` only, since a `select`'s list is bounded by
 * its question. Kept most-held-first, so what survives the cut is what gets used.
 */
export const MAX_FACET_OPTIONS = 500;

/**
 * Selects users whose answer to a facet is absent, which organizers actually ask for.
 *
 * A sentinel rather than a per-facet boolean keeps the wire format one array per facet.
 * Printable and URL-safe: a NUL byte cannot survive Postgres `text` or a query string.
 */
export const NO_VALUE = '__NO_VALUE__';

/**
 * The state facet's second row. The facet is exactly two options, home and not home,
 * because "local or travelling" drives catering, travel and housing where "which of
 * the fifty states" does not. Only offered when a home state is configured.
 */
export const OUT_OF_STATE = '__OUT_OF_STATE__';

/**
 * A university we can place, outside the US. An internal bucket key, never an offered
 * option: international applicants are counted inside `OUT_OF_STATE`. Exported because
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
 * A facet key, taken apart. The panel treats keys as opaque; the two ends that parse
 * them are the client's params builder and the server's predicate builder.
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
