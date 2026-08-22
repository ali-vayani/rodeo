/**
 * CSV reading, shared by every feature that accepts an uploaded file.
 *
 * A real parser rather than `split(',')`: exports from Excel and Google Sheets carry
 * quoted fields, embedded commas, CRLF endings and a UTF-8 BOM, each of which a naive
 * split turns into silently wrong data rather than a visible error.
 */

/**
 * Splits CSV text into rows of raw fields, per RFC 4180.
 *
 * Inputs:
 * - text: string — CSV text, optionally BOM-prefixed, with LF or CRLF endings
 *
 * Outputs:
 * - string[][] — one entry per non-blank row, fields unquoted and untrimmed
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
