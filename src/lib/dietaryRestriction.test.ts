import { describe, expect, it } from 'vitest';
import { normalizeDietaryRestriction } from './dietaryRestriction';

describe('normalizeDietaryRestriction', () => {
	it('leaves an empty selection empty', () => {
		expect(normalizeDietaryRestriction([])).toEqual([]);
	});

	it('drops the "none" placeholder, leaving the regular pool', () => {
		expect(normalizeDietaryRestriction(['No dietary restrictions'])).toEqual([]);
	});

	it('matches the placeholder case- and whitespace-insensitively', () => {
		expect(normalizeDietaryRestriction([' no dietary restrictions '])).toEqual([]);
	});

	it('drops the placeholder but keeps a real restriction selected alongside it', () => {
		expect(normalizeDietaryRestriction(['No dietary restrictions', 'Vegan'])).toEqual(['Vegan']);
	});

	it('leaves a real restriction untouched', () => {
		expect(normalizeDietaryRestriction(['Vegan'])).toEqual(['Vegan']);
	});
});
