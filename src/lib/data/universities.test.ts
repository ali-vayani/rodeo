import { describe, it, expect } from 'vitest';
import { loadUniversities, universityLabel } from './universities';

/**
 * Guards on generated data, so these are checks on `scripts/build-universities.mjs`
 * rather than on hand-written code. A source that moves — a renamed IPEDS column, a
 * changed Hipo key — otherwise produces a file that still parses and a dropdown that
 * is quietly empty or quietly American-only.
 */

const { countries, universities } = await loadUniversities();

describe('the university dataset', () => {
	it('has the whole of North America in it, not a fragment', () => {
		// Rough floors, not exact counts: a regeneration that legitimately adds or drops a
		// few hundred rows should pass, while a source going missing should not.
		expect(universities.length).toBeGreaterThan(6000);
		expect(universities.filter((u) => u.country === 'US').length).toBeGreaterThan(5000);
		expect(universities.filter((u) => u.country !== 'US').length).toBeGreaterThan(400);
	});

	it('names every institution exactly once', () => {
		// The value is the answer that gets stored, so a repeat is two rows an applicant
		// cannot tell apart and two filter entries an organizer has to select both of.
		const names = new Set(universities.map((u) => u.name));
		expect(names.size).toBe(universities.length);
	});

	it('has a non-empty name on every row', () => {
		expect(universities.every((u) => u.name.trim().length > 0)).toBe(true);
	});

	it('names the country of every row it contains', () => {
		// `universityLabel` falls back to the bare code, so a gap here degrades to
		// "Rice University — CA" rather than failing loudly. Caught in the data instead.
		for (const university of universities) expect(countries).toHaveProperty(university.country);
	});

	it('is North America only', () => {
		// The Pacific US territories are the interesting exclusion — they are US rows in
		// IPEDS and Oceania on a map.
		const seen = new Set(universities.map((u) => u.country));
		for (const oceania of ['AS', 'GU', 'MP', 'FM', 'MH', 'PW']) expect(seen).not.toContain(oceania);
		expect(seen).not.toContain('GB');
		expect(seen).not.toContain('IN');
	});

	it('gives US rows a city and a state, which is what IPEDS is for', () => {
		const us = universities.filter((u) => u.country === 'US');
		expect(us.every((u) => u.city && u.region)).toBe(true);
	});

	it('carries the aliases people actually type', () => {
		const ut = universities.find((u) => u.name === 'The University of Texas at Austin');
		expect(ut?.aliases).toContain('UT Austin');
	});

	it('is sorted by name, so an unfiltered list opens somewhere sensible', () => {
		const sorted = [...universities].sort((a, b) => a.name.localeCompare(b.name, 'en'));
		expect(universities.map((u) => u.name)).toEqual(sorted.map((u) => u.name));
	});
});

describe('universityLabel', () => {
	it('locates a US school by city and state, without the country', () => {
		// " — United States" on six thousand rows is noise in a list this parochial.
		expect(
			universityLabel(
				{ name: 'Rice University', city: 'Houston', region: 'TX', country: 'US' },
				countries
			)
		).toBe('Rice University — Houston, TX');
	});

	it('locates a foreign school by region and country', () => {
		expect(
			universityLabel(
				{ name: 'University of Waterloo', region: 'Ontario', country: 'CA' },
				countries
			)
		).toBe('University of Waterloo — Ontario, Canada');
	});

	it('falls back to the country alone when there is no region', () => {
		expect(universityLabel({ name: 'Tecnológico de Monterrey', country: 'MX' }, countries)).toBe(
			'Tecnológico de Monterrey — Mexico'
		);
	});

	it('is just the name when nothing locates it', () => {
		expect(universityLabel({ name: 'Somewhere', country: 'US' }, countries)).toBe('Somewhere');
	});

	it('shows the raw code rather than nothing for an unmapped country', () => {
		expect(universityLabel({ name: 'Somewhere', country: 'ZZ' }, {})).toBe('Somewhere — ZZ');
	});
});
