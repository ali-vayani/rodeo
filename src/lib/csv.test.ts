import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

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
