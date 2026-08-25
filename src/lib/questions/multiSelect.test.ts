import { describe, it, expect } from 'vitest';
import {
	decodeMultiSelect,
	encodeMultiSelect,
	encodeMultiSelectMember,
	splitWriteIn
} from './multiSelect';

describe('encodeMultiSelect', () => {
	it('round-trips a selection', () => {
		expect(decodeMultiSelect(encodeMultiSelect(['Web', 'Hardware']))).toEqual(['Web', 'Hardware']);
	});

	it('encodes an empty selection as blank, not as an empty array', () => {
		// The whole app already reads '' as unanswered — `isAnswered`, the submit gate, the
		// facet `noneCount`, the two spellings of absent in the filter predicate. '[]' would
		// be a second spelling that none of them recognise, so a required question could be
		// submitted with nothing ticked.
		expect(encodeMultiSelect([])).toBe('');
	});

	it('survives option text containing the separators a delimited list would use', () => {
		const awkward = ['Rust, Go', 'C++\nAssembly', 'He said "hi"'];
		expect(decodeMultiSelect(encodeMultiSelect(awkward))).toEqual(awkward);
	});
});

describe('decodeMultiSelect', () => {
	it('reads a blank as an empty selection', () => {
		expect(decodeMultiSelect('')).toEqual([]);
	});

	it('reads an answer left behind by an older question type as empty', () => {
		// Switching a DROPDOWN to MULTI_SELECT leaves every stored answer as bare text.
		// Throwing here would take down the admissions list for one legacy row.
		expect(decodeMultiSelect('Web')).toEqual([]);
	});

	it('rejects JSON that is not a list of strings', () => {
		expect(decodeMultiSelect('{"a":1}')).toEqual([]);
		expect(decodeMultiSelect('[1,2]')).toEqual([]);
		expect(decodeMultiSelect('["ok",null]')).toEqual([]);
	});
});

describe('splitWriteIn', () => {
	const OPTIONS = ['Web', 'Hardware'];

	it('separates the write-in from the offered options it sits beside', () => {
		expect(splitWriteIn(['Web', 'Robotics'], OPTIONS)).toEqual({
			selected: ['Web'],
			writeIn: 'Robotics'
		});
	});

	it('reports no write-in when every member is on the list', () => {
		expect(splitWriteIn(['Web', 'Hardware'], OPTIONS)).toEqual({
			selected: ['Web', 'Hardware'],
			writeIn: null
		});
	});

	it('keeps a write-in that matches no option even when it is the only member', () => {
		expect(splitWriteIn(['Robotics'], OPTIONS)).toEqual({ selected: [], writeIn: 'Robotics' });
	});

	it('surfaces a renamed option as a write-in rather than dropping the answer', () => {
		// Renaming "Hardware" in the editor doesn't rewrite stored answers. The old value
		// has to keep showing up somewhere, and the Other box is where it can be read.
		expect(splitWriteIn(['Hardware'], ['Hardware & IoT'])).toEqual({
			selected: [],
			writeIn: 'Hardware'
		});
	});
});

describe('encodeMultiSelectMember', () => {
	it('quotes the option so one choice cannot match a longer one', () => {
		// The filter predicate matches a member as a substring of the stored array. Without
		// the quotes, filtering on "Go" would also select everyone who picked "Golang".
		const stored = encodeMultiSelect(['Golang']);
		expect(stored.includes(encodeMultiSelectMember('Go'))).toBe(false);
		expect(stored.includes(encodeMultiSelectMember('Golang'))).toBe(true);
	});
});
