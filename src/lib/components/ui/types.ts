/**
 * Shared prop types for the UI primitives.
 *
 * Kept out of the `.svelte` files because a type exported from an instance
 * script is awkward to import and easy to break.
 */

/**
 * One option in a `MultiCombobox`. `count` is optional but load-bearing where it
 * exists: it is the only thing that tells an organizer two near-identical
 * universities are two real populations.
 */
export interface MultiComboboxOption {
	value: string;
	label?: string;
	count?: number;
	disabled?: boolean;
	/** Extra search terms — matched, never shown. See `Rankable.keywords`. */
	keywords?: readonly string[];
}

/**
 * One option in a single-select `Combobox`. Same shape minus the count, which is a
 * property of a filter facet rather than of a form field.
 */
export interface ComboboxOption {
	value: string;
	label?: string;
	disabled?: boolean;
	keywords?: readonly string[];
}

/** One tab in a `Tabs` rail. */
export interface TabItem {
	value: string;
	label: string;
	/** Small trailing count or status, e.g. a pending total. */
	badge?: string | number;
	disabled?: boolean;
}

/** One column of a `DataTable`. */
export interface Column<Row> {
	/** Stable key, also used as the `{#each}` key for the header cell. */
	key: string;
	header: string;
	/** Tailwind width utility, e.g. `w-32`. Omit to let the column size itself. */
	width?: string;
	/** Right-align — for counts and actions. */
	align?: 'left' | 'right';
	/** Keeps the cell on one line. */
	nowrap?: boolean;
	/** Clamps the cell to one ellipsized line, so long content cannot stretch the row. */
	truncate?: boolean;
	/** Plain text when there's no `cell` snippet for this column. */
	value?: (row: Row) => string;
}
