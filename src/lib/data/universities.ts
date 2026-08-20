/**
 * The North American university vocabulary, and the only sanctioned way to reach it.
 *
 * Nothing imports `universities.json` directly: it is 650 KB, and a static import
 * anywhere in the module graph would put it in the entry chunk. Regenerate with
 * `npm run data:universities`.
 */

interface UniversityData {
	countries: Record<string, string>;
	universities: University[];
}

export interface University {
	name: string;
	/** IPEDS rows only, so US institutions. */
	city?: string;
	/** US state code, or a province/state name on the tenth of Hipo rows that carry one. */
	region?: string;
	/** ISO 3166-1 alpha-2. */
	country: string;
	/**
	 * Other names the institution is known by, such as `UT Austin`. Present on about a
	 * third of US rows and the reason search works at all.
	 */
	aliases?: string[];
}

/** Cached across calls, because parsing 650 KB of JSON is not free and two callers
    can ask within one navigation. */
let cached: Promise<UniversityData> | null = null;

export function loadUniversities(): Promise<UniversityData> {
	cached ??= import('./universities.json').then((module) => module.default as UniversityData);
	return cached;
}

/**
 * How an institution reads in the dropdown. Location earns its place only when it
 * distinguishes, so a US row shows `City, ST` and drops the country.
 */
export function universityLabel(university: University, countries: Record<string, string>): string {
	const country = countries[university.country] ?? university.country;
	const where =
		university.country === 'US'
			? [university.city, university.region].filter(Boolean).join(', ')
			: [university.region, country].filter(Boolean).join(', ');

	return where ? `${university.name} — ${where}` : university.name;
}
