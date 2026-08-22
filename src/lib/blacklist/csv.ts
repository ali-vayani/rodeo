/** Column mapping for blacklist import, over the shared CSV reader. */

import { parseCsv } from '$lib/csv';

export interface BlacklistCsvRow {
	firstName: string;
	lastName: string;
	email?: string;
	reason?: string;
}

/** Column aliases accepted in a header row, normalized to lowercase without separators. */
const COLUMN_ALIASES: Record<string, keyof BlacklistCsvRow> = {
	firstname: 'firstName',
	first: 'firstName',
	givenname: 'firstName',
	lastname: 'lastName',
	last: 'lastName',
	surname: 'lastName',
	familyname: 'lastName',
	email: 'email',
	emailaddress: 'email',
	mail: 'email',
	reason: 'reason',
	note: 'reason',
	notes: 'reason'
};

/** Order assumed when a file has no header row. */
const POSITIONAL: (keyof BlacklistCsvRow)[] = ['firstName', 'lastName', 'email', 'reason'];

const headerKey = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]/g, '');

/**
 * Read blacklist rows out of CSV text.
 *
 * A header is detected rather than assumed. Blindly dropping the first line silently
 * eats a real entry whenever someone exports without headers.
 *
 * Validation deliberately does not happen here: the server checks each row and reports
 * which failed, so parsing only has to answer "what did the file say".
 */
export function parseBlacklistCsv(text: string): BlacklistCsvRow[] {
	const rows = parseCsv(text);
	if (!rows.length) return [];

	const firstRow = rows[0].map(headerKey);
	// Treat row one as a header only if every non-empty cell names a column we recognize.
	// A data row would have to consist entirely of the literal words "first", "email" and
	// so on to be mistaken for one.
	const nonEmpty = firstRow.filter((cell) => cell !== '');
	const isHeader = nonEmpty.length > 0 && nonEmpty.every((cell) => cell in COLUMN_ALIASES);

	const columns = isHeader
		? firstRow.map((cell) => COLUMN_ALIASES[cell] ?? null)
		: POSITIONAL.map((key) => key as keyof BlacklistCsvRow | null);

	return rows.slice(isHeader ? 1 : 0).map((cells) => {
		const row: BlacklistCsvRow = { firstName: '', lastName: '' };

		cells.forEach((cell, index) => {
			const key = columns[index];
			if (!key) return;
			const value = cell.trim();
			if (value) row[key] = value;
		});

		return row;
	});
}
