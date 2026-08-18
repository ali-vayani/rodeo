import { describe, it, expect } from 'vitest';
import { jaro, jaroWinkler, normalizeName, bestTokenScore, tokenMatch } from './similarity';
import { NAME_SIMILARITY_THRESHOLD } from '$lib/blacklist/match';
import { SEARCH_SIMILARITY_THRESHOLD } from '$lib/server/recipients';

/**
 * The algorithm's own suite. `$lib/blacklist/match.test.ts` covers the same functions
 * through the blacklist's threshold and is deliberately left untouched — these are the
 * properties that hold regardless of who is comparing what.
 */

describe('normalizeName', () => {
	it('folds accents to their base letters', () => {
		expect(normalizeName('José')).toBe('jose');
		expect(normalizeName('Renée')).toBe('renee');
	});

	it('strips the punctuation that names are inconsistently typed with', () => {
		expect(normalizeName("O'Brien")).toBe('obrien');
		expect(normalizeName('O’Brien')).toBe('obrien');
		expect(normalizeName('Smith-Jones')).toBe('smithjones');
	});

	it('collapses whitespace and case', () => {
		expect(normalizeName('  JAY   PATIL ')).toBe('jay patil');
	});

	it('returns an empty string for input that is all punctuation', () => {
		expect(normalizeName(" -.'  ")).toBe('');
	});
});

describe('jaro', () => {
	it('is 1 for identical strings and 0 for disjoint ones', () => {
		expect(jaro('chen', 'chen')).toBe(1);
		expect(jaro('abc', 'xyz')).toBe(0);
	});

	it('is 0 when either side is empty', () => {
		expect(jaro('', 'chen')).toBe(0);
		expect(jaro('chen', '')).toBe(0);
	});

	it('is symmetric', () => {
		expect(jaro('martha', 'marhta')).toBeCloseTo(jaro('marhta', 'martha'));
	});

	it('applies no prefix bonus — that is Winkler s part', () => {
		// The textbook pair: jaro .944, jaro-winkler .961.
		expect(jaro('martha', 'marhta')).toBeCloseTo(0.944, 3);
		expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
	});
});

describe('jaroWinkler', () => {
	it('is 1 for identical strings', () => {
		expect(jaroWinkler('chen', 'chen')).toBe(1);
	});

	it('is symmetric', () => {
		expect(jaroWinkler('hassan', 'hasan')).toBeCloseTo(jaroWinkler('hasan', 'hassan'));
	});

	it('withholds the prefix bonus below the boost threshold', () => {
		// A shared prefix must not rescue a pair that is otherwise a poor match, which
		// is the whole reason the boost is gated rather than always applied.
		const score = jaroWinkler('abcdef', 'abzzzzzzzz');
		expect(score).toBe(jaro('abcdef', 'abzzzzzzzz'));
		expect(score).toBeLessThan(0.7);
	});

	it('caps the prefix bonus at four characters', () => {
		// Beyond four, extra shared prefix buys nothing — otherwise a long common stem
		// would drag unrelated words together.
		const four = jaroWinkler('abcdX', 'abcdY');
		const five = jaroWinkler('abcdeX', 'abcdeY');
		const boostFour = four - jaro('abcdX', 'abcdY');
		const boostFive = five - jaro('abcdeX', 'abcdeY');
		expect(boostFive / (1 - jaro('abcdeX', 'abcdeY'))).toBeCloseTo(0.4);
		expect(boostFour / (1 - jaro('abcdX', 'abcdY'))).toBeCloseTo(0.4);
	});
});

describe('bestTokenScore', () => {
	it('scores a one-word query against the closest token of a full name', () => {
		// The case the plain metric gets wrong: `chn` against the whole string is 0.478,
		// which no usable threshold would accept.
		expect(jaroWinkler('chn', 'sarah chen')).toBeLessThan(SEARCH_SIMILARITY_THRESHOLD);
		expect(bestTokenScore('chn', 'sarah chen')).toBeGreaterThanOrEqual(SEARCH_SIMILARITY_THRESHOLD);
	});

	it('still matches the full string when the query is a full name', () => {
		expect(bestTokenScore('sarah chen', 'sarah chen')).toBe(1);
	});

	it('does not invent a match for an unrelated query', () => {
		expect(bestTokenScore('bob', 'sarah chen')).toBeLessThan(SEARCH_SIMILARITY_THRESHOLD);
	});

	it('never scores below the plain metric', () => {
		expect(bestTokenScore('rodrigez', 'maria rodriguez')).toBeGreaterThanOrEqual(
			jaroWinkler('rodrigez', 'maria rodriguez')
		);
	});

	it('is the single-token view of tokenMatch', () => {
		// Kept as its own export because that is the whole question a one-word query
		// asks, and the combobox type-ahead calls it a token at a time.
		expect(bestTokenScore('chn', 'sarah chen')).toBe(tokenMatch('chn', 'sarah chen').best);
	});
});

describe('tokenMatch — multi-word queries', () => {
	it('scores each query token against the name, not the query as a whole', () => {
		// The bug this replaced: scoring `sarh chn` end-to-end against each name token
		// gives `harsh` .808 and `chen` ~0, so eleven Harshes outranked every Chen.
		expect(jaroWinkler('sarh chn', 'harsh')).toBeGreaterThan(jaroWinkler('sarh chn', 'chen'));
		expect(tokenMatch('sarh chn', 'zhizhen chen').best).toBeGreaterThan(
			tokenMatch('sarh chn', 'harsh vayani').best
		);
	});

	it('reaches a name on the strength of one convincing token', () => {
		// `chn`/`chen` is .933 and carries the candidate on its own — this is the recall
		// the feature lives on, and why qualification reads `best` rather than `score`.
		expect(tokenMatch('sarh chn', 'zhizhen chen').best).toBeGreaterThanOrEqual(
			SEARCH_SIMILARITY_THRESHOLD
		);
	});

	it('ranks a name matching every token above one matching a single token', () => {
		const both = tokenMatch('sarh chn', 'sarah chen').score;
		expect(both).toBeGreaterThan(tokenMatch('sarh chn', 'sarah gulati').score);
		expect(both).toBeGreaterThan(tokenMatch('sarh chn', 'zhizhen chen').score);
	});

	it('would be unsatisfiable if the mean were thresholded instead of ranked on', () => {
		// Why qualification cannot read `score`: the correct answer scores .69 here, so a
		// .80 floor on the mean would return nothing for any two-token query.
		expect(tokenMatch('sarh chn', 'zhizhen chen').score).toBeLessThan(SEARCH_SIMILARITY_THRESHOLD);
	});

	it('keeps the mean in [0,1] so a longer query cannot outscore a shorter one', () => {
		// A sum would make relevance a function of how many words were typed.
		expect(tokenMatch('sarah chen lovelace', 'sarah chen lovelace').score).toBe(1);
		expect(tokenMatch('sarah', 'sarah').score).toBe(1);
	});

	it('matches a query typed without spaces against a spaced name', () => {
		// The whole value stays a candidate alongside its tokens.
		expect(tokenMatch('sarahchen', 'sarah chen').best).toBeGreaterThanOrEqual(
			SEARCH_SIMILARITY_THRESHOLD
		);
	});

	it('is zero for an empty query', () => {
		expect(tokenMatch('', 'sarah chen')).toEqual({ score: 0, best: 0 });
	});

	it('invents nothing for an unrelated multi-word query', () => {
		expect(tokenMatch('bob smith', 'sarah chen').best).toBeLessThan(SEARCH_SIMILARITY_THRESHOLD);
	});
});

describe('thresholds stay with their policies, not with the algorithm', () => {
	it('keeps search more permissive than the blacklist', () => {
		// A blacklist hit accuses someone; a search hit only puts a row on screen. If
		// these ever converge, one of the two has been tuned by the wrong criterion.
		expect(SEARCH_SIMILARITY_THRESHOLD).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
	});

	it('rejects patel/patil for the blacklist but offers it as a search suggestion', () => {
		const score = jaroWinkler('patel', 'patil');
		expect(score).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
		expect(score).toBeGreaterThanOrEqual(SEARCH_SIMILARITY_THRESHOLD);
	});
});
