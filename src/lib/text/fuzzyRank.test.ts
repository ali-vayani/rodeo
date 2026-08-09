import { describe, expect, it } from 'vitest';
import { rankOptions } from './fuzzyRank';
import { NO_VALUE } from '$lib/linkedFields';

/**
 * Shaped like the real university vocabulary: server-sorted by count descending,
 * with the two spellings of UT Austin that motivated the whole feature.
 */
const UNIVERSITIES = [
	{ value: 'The University of Texas at Austin', count: 408 },
	{ value: 'University of Texas at Austin', count: 120 },
	{ value: 'Texas A&M University', count: 96 },
	{ value: 'University of Texas at Dallas', count: 74 },
	{ value: 'Rice University', count: 41 },
	{ value: 'University of Houston', count: 33 },
	{ value: 'Massachusetts Institute of Technology', count: 12 },
	{ value: 'Stanford University', count: 9 }
];

const values = (options: { value: string }[]) => options.map((option) => option.value);

describe('rankOptions', () => {
	it('returns the list untouched for an empty query', () => {
		expect(rankOptions(UNIVERSITIES, '')).toEqual(UNIVERSITIES);
		expect(rankOptions(UNIVERSITIES, '   ')).toEqual(UNIVERSITIES);
	});

	it('keeps the server order within a tier, so the bigger population leads', () => {
		// 408 users spell it "The University of…" and 120 spell it without — both must
		// show, and the one an organizer is most likely to want must be first.
		const ranked = values(rankOptions(UNIVERSITIES, 'texas at austin'));
		expect(ranked.slice(0, 2)).toEqual([
			'The University of Texas at Austin',
			'University of Texas at Austin'
		]);
	});

	it('filters to substring matches when the query appears verbatim', () => {
		expect(values(rankOptions(UNIVERSITIES, 'dallas'))).toEqual(['University of Texas at Dallas']);
		expect(values(rankOptions(UNIVERSITIES, 'houston'))).toEqual(['University of Houston']);
	});

	it('ranks a prefix match above a mid-string match', () => {
		// "University of Texas at Dallas" starts with the query; the others only
		// contain it. Typing more characters must never demote what already leads.
		const ranked = values(rankOptions(UNIVERSITIES, 'university of texas'));
		expect(ranked[0]).toBe('University of Texas at Austin');
		expect(ranked).toContain('The University of Texas at Austin');
	});

	it('puts every verbatim match above every fuzzy one', () => {
		const ranked = values(rankOptions(UNIVERSITIES, 'stanford university'));
		expect(ranked[0]).toBe('Stanford University');
		// The remaining "…University" entries only match fuzzily, so they trail.
		expect(ranked.slice(1)).not.toContain('Stanford University');
	});

	it('surfaces the real values for a misspelled query', () => {
		const ranked = values(rankOptions(UNIVERSITIES, 'univercity of texas'));
		expect(ranked).toContain('The University of Texas at Austin');
		expect(ranked).toContain('University of Texas at Austin');
		expect(ranked[0]).toBe('The University of Texas at Austin');
	});

	it('does not let the fuzzy tier drag in everything with a shared word', () => {
		const ranked = values(rankOptions(UNIVERSITIES, 'univercity of texas'));
		expect(ranked).not.toContain('Rice University');
		expect(ranked).not.toContain('Massachusetts Institute of Technology');
	});

	it('tolerates a typo in a single-word query', () => {
		expect(values(rankOptions(UNIVERSITIES, 'stanfrd'))).toEqual(['Stanford University']);
	});

	it('returns nothing when the query resembles nothing', () => {
		expect(rankOptions(UNIVERSITIES, 'qqqqzzzz')).toEqual([]);
	});

	it('matches the sentinel row on its label, never on its stored value', () => {
		const options = [...UNIVERSITIES, { value: NO_VALUE, label: 'No university', count: 530 }];
		expect(values(rankOptions(options, 'no univ'))).toEqual([NO_VALUE]);
		// The sentinel is a value nobody could type, so it must not leak into
		// unrelated searches.
		expect(values(rankOptions(options, 'rice'))).toEqual(['Rice University']);
	});

	it('finds a surname typed on its own, misspelled', () => {
		// The Full Name facet is one option per person, so a query is almost always a
		// fragment of the value rather than the whole of it.
		const people = [
			{ value: 'Sarah Chen', count: 1 },
			{ value: 'Marcus Webb', count: 1 },
			{ value: 'Priya Raman', count: 1 }
		];
		expect(values(rankOptions(people, 'chn'))).toEqual(['Sarah Chen']);
		expect(values(rankOptions(people, 'webb'))).toEqual(['Marcus Webb']);
	});

	it('is case-insensitive', () => {
		expect(values(rankOptions(UNIVERSITIES, 'TEXAS A&M'))).toEqual(['Texas A&M University']);
		expect(values(rankOptions(UNIVERSITIES, 'RiCe'))).toEqual(['Rice University']);
	});
});
