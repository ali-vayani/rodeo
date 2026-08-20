/**
 * CSV reading for blacklist import.
 *
 * Deliberately a real parser rather than `split(',')`. The files organizers upload come
 * out of Excel and Google Sheets, so they carry quoted fields, embedded commas in the
 * reason column, CRLF endings and a UTF-8 BOM. A naive split turns each of those into
 * silently wrong data rather than a visible error.
 */

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
 * Split CSV text into rows of raw fields, per RFC 4180.
 *
 * Exported for its own tests: the quoting rules are where CSV parsers usually go wrong.
 */
export function parseCsv(text: string): string[][] {
	// A BOM would otherwise ride along on the first header cell and defeat column matching.
	const input = text.replace(/^\uFEFF/, '');

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let i = 0;

	/** A row is only recorded if it holds something; blank lines are structural noise. */
	const endRow = () => {
		row.push(field);
		field = '';
		if (row.some((cell) => cell.trim() !== '')) rows.push(row);
		row = [];
	};

	while (i < input.length) {
		const char = input[i];

		if (quoted) {
			if (char === '"') {
				// A doubled quote inside a quoted field is an escaped literal quote.
				if (input[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			field += char;
			i++;
			continue;
		}

		if (char === '"') {
			quoted = true;
			i++;
			continue;
		}

		if (char === ',') {
			row.push(field);
			field = '';
			i++;
			continue;
		}

		if (char === '\r' || char === '\n') {
			endRow();
			// Consume CRLF as one terminator rather than two, which would otherwise produce a
			// phantom blank row between every real one.
			i += char === '\r' && input[i + 1] === '\n' ? 2 : 1;
			continue;
		}

		field += char;
		i++;
	}

	// A file not ending in a newline still has one last row pending.
	if (field !== '' || row.length) endRow();

	return rows;
}

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
