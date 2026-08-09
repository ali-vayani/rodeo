/**
 * The application questions that write through to a `User` column, and the filter
 * vocabulary derived from them.
 *
 * A question carrying a `linkedField` is the single definition of both the data and
 * the control that filters it: `application.save` writes the answer into the named
 * `User` column, and the admin filter panels render a control chosen from that same
 * question's `type`. Change Year from a dropdown to short text in the editor and its
 * filter follows, because nothing here hardcodes which field gets which control.
 *
 * Deliberately isomorphic — imported by the filter UI (browser) and by the routers
 * that build the Prisma predicate (server). Keep it free of Prisma, node builtins
 * and `$env`.
 */

/**
 * The `User` columns a question may write through to.
 *
 * This was an inline `const` in `application.save`, which is why nothing else could
 * reuse it. It is the allowlist for a computed property assignment into a Prisma
 * `update`, so it must stay a closed set — widening it to `string` would let a
 * question's `linkedField` name any column on the model.
 */
export const LINKED_USER_FIELDS = ['name', 'university', 'year'] as const;

export type LinkedUserField = (typeof LINKED_USER_FIELDS)[number];

/**
 * The linked fields that get a filter control, which is not all of them.
 *
 * `name` is deliberately absent. It is a linked field like the others — the predicate
 * accepts `names`, and the search box's suggestion chips set it — but it has one
 * distinct value per person, so a list of them is a directory rather than a
 * vocabulary. Picking a hackathon's applicants out of ~1,900 names by scrolling is not
 * a filter; typing the name is, and the typo-tolerant search box already does that.
 *
 * So this governs which **facets** are offered, never which fields the predicate
 * accepts — `names` stays fully functional, and removing the control does not remove
 * the filter.
 */
export const FILTERABLE_LINKED_FIELDS = ['university', 'year'] as const satisfies readonly [
	...LinkedUserField[]
];

export function isLinkedUserField(value: string | null | undefined): value is LinkedUserField {
	return value != null && (LINKED_USER_FIELDS as readonly string[]).includes(value);
}

/**
 * Which control a facet renders as, derived from the question's `type`.
 *
 * `select` — the question already enumerates its answers (`DROPDOWN`,
 * `MULTIPLE_CHOICE`), so `Question.options` is authoritative and the filter is a
 * plain multi-select.
 *
 * `combobox` — free text, so there is no authoritative list and the vocabulary is
 * whatever users have actually typed. Needs type-ahead and typo tolerance to be
 * usable at all.
 */
export type LinkedFacetControl = 'select' | 'combobox';

export interface LinkedFacetOption {
	/** Verbatim stored `User` column value. Never the empty string — see `noneCount`. */
	value: string;
	/** How many users currently hold it. Shown in the UI so near-duplicate values are visible. */
	count: number;
}

export interface LinkedFacet {
	field: LinkedUserField;
	/** The question's title, so the filter is labelled the way the form is. */
	label: string;
	control: LinkedFacetControl;
	options: LinkedFacetOption[];
	/** Users with NULL or empty in this column, selectable via `NO_VALUE`. */
	noneCount: number;
	/**
	 * The option list was cut at `MAX_FACET_OPTIONS`; rarer values are missing.
	 *
	 * Only ever set on a `combobox`, whose vocabulary is unbounded by construction —
	 * on the dev database the Full Name facet alone has 1,852 distinct values and is
	 * 74 KB of the 78 KB payload. Absent or false means the list is complete.
	 *
	 * The UI should say so rather than implying a value doesn't exist: the exact
	 * predicate still accepts any value, and the search box (which is typo-tolerant
	 * and hits the database) is how someone finds a name that isn't listed.
	 */
	truncated?: boolean;
}

/**
 * Most options a facet returns.
 *
 * Applies to `combobox` facets only — a `select`'s list is bounded by the question
 * that declares it. Kept most-held-first, so what survives the cut is the part of the
 * vocabulary a filter is actually used on.
 */
export const MAX_FACET_OPTIONS = 500;

/**
 * Selects users whose value for a linked field is absent.
 *
 * Roughly a third of seeded users have no university and no year, and "who hasn't
 * filled this in" is a question organizers actually ask. A sentinel rather than a
 * per-field boolean keeps the wire format one array per field, so the
 * engaged-but-empty rule below applies uniformly.
 *
 * Printable and URL-safe on purpose. This was briefly a NUL byte, on the reasoning
 * that no real answer could contain one — true, but it also cannot survive the places
 * a filter selection legitimately travels: Postgres `text` rejects NUL outright, and
 * `%00` in a query string is refused by some proxies and by Node's URL parsing, which
 * would have broken a shareable filtered link the first time anyone made one.
 *
 * Collision with a real answer is therefore possible in principle rather than
 * impossible by construction — but it would take a user whose university is literally
 * `__NO_VALUE__`, and the cost of that is one misfiled row in a filter, against a
 * hazard that would have broken shareable links outright.
 */
export const NO_VALUE = '__NO_VALUE__';

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
