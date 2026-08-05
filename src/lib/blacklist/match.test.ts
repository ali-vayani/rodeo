import { describe, it, expect } from 'vitest';
import {
	normalizeEmail,
	normalizeName,
	splitName,
	jaroWinkler,
	prepareBlacklist,
	matchApplicant,
	NAME_SIMILARITY_THRESHOLD,
	type BlacklistEntryLike
} from './match';

const entry = (
	firstName: string,
	lastName: string,
	email: string | null = null
): BlacklistEntryLike => ({ firstName, lastName, email });

describe('normalizeEmail', () => {
	it('trims and lowercases', () => {
		expect(normalizeEmail('  Bad@Example.COM ')).toBe('bad@example.com');
	});
});

describe('normalizeName', () => {
	it('strips diacritics so accented and unaccented spellings compare equal', () => {
		expect(normalizeName('José')).toBe(normalizeName('Jose'));
	});

	it('folds both apostrophe characters and the unpunctuated spelling together', () => {
		expect(normalizeName("O'Brien")).toBe('obrien');
		expect(normalizeName('O’Brien')).toBe('obrien');
		expect(normalizeName('OBrien')).toBe('obrien');
	});

	it('drops hyphens from compound surnames', () => {
		expect(normalizeName('Smith-Jones')).toBe('smithjones');
	});

	it('lowercases and collapses runs of whitespace', () => {
		expect(normalizeName('  JAY   PATIL ')).toBe('jay patil');
	});
});

describe('splitName', () => {
	it('takes the first and last token', () => {
		expect(splitName('John Doe')).toEqual({ first: 'john', last: 'doe' });
	});

	it('ignores middle names and initials', () => {
		expect(splitName('John Q. Doe')).toEqual({ first: 'john', last: 'doe' });
	});

	it('reduces a multi-part surname to its final token', () => {
		expect(splitName('Maria de la Cruz')).toEqual({ first: 'maria', last: 'cruz' });
	});

	it('returns null for a single-token name, which has no last name to gate on', () => {
		expect(splitName('Adam')).toBeNull();
		expect(splitName('   ')).toBeNull();
	});
});

describe('jaroWinkler', () => {
	it('scores identical strings 1', () => {
		expect(jaroWinkler('smith', 'smith')).toBe(1);
	});

	it('scores strings with nothing in common 0', () => {
		expect(jaroWinkler('abc', 'xyz')).toBe(0);
	});

	// The threshold is only meaningful if it sits between real typos and genuinely
	// different surnames. These are the pairs the constant was calibrated against.
	it.each([
		['hassan', 'hasan'],
		['john', 'jhon'],
		['garcia', 'garca'],
		['nguyen', 'nguyan']
	])('treats %s/%s as the same name', (a, b) => {
		expect(jaroWinkler(a, b)).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
	});

	it.each([
		['patel', 'patil'],
		['chen', 'chan'],
		['smith', 'smyth'],
		['stevens', 'stephens'],
		['jon', 'tom']
	])('keeps %s/%s apart as distinct names', (a, b) => {
		expect(jaroWinkler(a, b)).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
	});

	it('is symmetric', () => {
		expect(jaroWinkler('hassan', 'hasan')).toBeCloseTo(jaroWinkler('hasan', 'hassan'));
	});
});

describe('prepareBlacklist', () => {
	it('normalizes emails into the lookup set', () => {
		const prepared = prepareBlacklist([entry('Bad', 'Actor', '  Bad@Example.COM ')]);
		expect(prepared.emails.has('bad@example.com')).toBe(true);
	});

	it('skips entries missing half a name, which would otherwise match everyone', () => {
		const prepared = prepareBlacklist([entry('', '', 'bad@example.com'), entry('John', '')]);
		expect(prepared.names).toEqual([]);
	});
});

describe('matchApplicant', () => {
	it('returns EMAIL on an exact address match, ignoring case', () => {
		const blacklist = prepareBlacklist([entry('Bad', 'Actor', 'bad@example.com')]);
		expect(matchApplicant({ name: 'Someone Else', email: 'BAD@example.com' }, blacklist)).toBe(
			'EMAIL'
		);
	});

	it('returns NAME_EXACT when both name parts match verbatim', () => {
		const blacklist = prepareBlacklist([entry('John', 'Doe')]);
		expect(matchApplicant({ name: 'john doe', email: 'ok@example.com' }, blacklist)).toBe(
			'NAME_EXACT'
		);
	});

	it('returns NAME_FUZZY for a misspelling of both parts', () => {
		const blacklist = prepareBlacklist([entry('Hassan', 'Garcia')]);
		expect(matchApplicant({ name: 'Hasan Garca', email: 'ok@example.com' }, blacklist)).toBe(
			'NAME_FUZZY'
		);
	});

	it('requires both parts to match, not just the surname', () => {
		const blacklist = prepareBlacklist([entry('John', 'Smith')]);
		expect(matchApplicant({ name: 'Priya Smith', email: 'ok@example.com' }, blacklist)).toBeNull();
	});

	it('does not match a shared first name alone', () => {
		const blacklist = prepareBlacklist([entry('John', 'Smith')]);
		expect(matchApplicant({ name: 'John Okafor', email: 'ok@example.com' }, blacklist)).toBeNull();
	});

	it('prefers EMAIL over a name match on the same applicant', () => {
		const blacklist = prepareBlacklist([entry('John', 'Doe', 'john@example.com')]);
		expect(matchApplicant({ name: 'John Doe', email: 'john@example.com' }, blacklist)).toBe(
			'EMAIL'
		);
	});

	it('prefers an exact name match found after a fuzzy one', () => {
		// Ordering matters: the fuzzy entry is scanned first, so returning early on it would
		// downgrade an applicant who is in fact listed exactly.
		const blacklist = prepareBlacklist([entry('Hasan', 'Garca'), entry('Hassan', 'Garcia')]);
		expect(matchApplicant({ name: 'Hassan Garcia', email: 'ok@example.com' }, blacklist)).toBe(
			'NAME_EXACT'
		);
	});

	it('never name-matches an applicant with a single-token name', () => {
		const blacklist = prepareBlacklist([entry('Adam', 'Adam')]);
		expect(matchApplicant({ name: 'Adam', email: 'ok@example.com' }, blacklist)).toBeNull();
	});

	it('returns null against an empty blacklist', () => {
		expect(matchApplicant({ name: 'John Doe', email: 'a@b.com' }, prepareBlacklist([]))).toBeNull();
	});
});
