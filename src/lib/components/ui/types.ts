/**
 * Shared prop types for the UI primitives.
 *
 * Kept out of the `.svelte` files because a type exported from an instance
 * script is awkward to import and easy to break.
 */

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
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
	/** Plain text when there's no `cell` snippet for this column. */
	value?: (row: Row) => string;
}
