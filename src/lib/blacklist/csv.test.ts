import { describe, it, expect } from 'vitest';
import { parseCsv, parseBlacklistCsv } from './csv';

describe('parseCsv', () => {
	it('splits plain rows and fields', () => {
		expect(parseCsv('a,b\nc,d')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('keeps commas inside quoted fields', () => {
		expect(parseCsv('a,"one, two",c')).toEqual([['a', 'one, two', 'c']]);
	});

	it('unescapes doubled quotes', () => {
		expect(parseCsv('a,"he said ""hi""",c')).toEqual([['a', 'he said "hi"', 'c']]);
	});

	it('keeps newlines inside quoted fields', () => {
		expect(parseCsv('a,"line one\nline two"')).toEqual([['a', 'line one\nline two']]);
	});

	it('treats CRLF as a single row terminator', () => {
		expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('strips a UTF-8 BOM from the first field', () => {
		expect(parseCsv('﻿a,b')).toEqual([['a', 'b']]);
	});

	it('keeps the final row when the file has no trailing newline', () => {
		expect(parseCsv('a,b\nc,d')).toHaveLength(2);
	});

	it('drops blank lines', () => {
		expect(parseCsv('a,b\n\n\nc,d')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('returns nothing for empty input', () => {
		expect(parseCsv('')).toEqual([]);
	});
});

describe('parseBlacklistCsv', () => {
	it('maps columns by header name', () => {
		const rows = parseBlacklistCsv(
			'firstName,lastName,email,reason\nJohn,Doe,john@example.com,suspicious'
		);
		expect(rows).toEqual([
			{ firstName: 'John', lastName: 'Doe', email: 'john@example.com', reason: 'suspicious' }
		]);
	});

	it('accepts header aliases and arbitrary column order', () => {
		const rows = parseBlacklistCsv('Email,Surname,First\njohn@example.com,Doe,John');
		expect(rows).toEqual([{ firstName: 'John', lastName: 'Doe', email: 'john@example.com' }]);
	});

	it('keeps the first line as data when it is not a header', () => {
		// The naive `.slice(1)` shortcut silently eats this row.
		const rows = parseBlacklistCsv('John,Doe,john@example.com\nJane,Roe,jane@example.com');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ firstName: 'John', lastName: 'Doe', email: 'john@example.com' });
	});

	it('omits empty optional columns rather than storing blanks', () => {
		const rows = parseBlacklistCsv('firstName,lastName,email,reason\nJohn,Doe,,');
		expect(rows).toEqual([{ firstName: 'John', lastName: 'Doe' }]);
	});

	it('preserves a reason containing a comma', () => {
		const rows = parseBlacklistCsv(
			'firstName,lastName,email,reason\nJohn,Doe,john@example.com,"harassment, repeated"'
		);
		expect(rows[0].reason).toBe('harassment, repeated');
	});

	it('handles a real spreadsheet export: BOM, CRLF and quoting together', () => {
		const rows = parseBlacklistCsv(
			'﻿firstName,lastName,email,reason\r\nJohn,Doe,john@example.com,"a, b"\r\n'
		);
		expect(rows).toEqual([
			{ firstName: 'John', lastName: 'Doe', email: 'john@example.com', reason: 'a, b' }
		]);
	});

	it('returns nothing for an empty file', () => {
		expect(parseBlacklistCsv('')).toEqual([]);
	});

	it('returns nothing for a header with no data rows', () => {
		expect(parseBlacklistCsv('firstName,lastName,email,reason\n')).toEqual([]);
	});
});
