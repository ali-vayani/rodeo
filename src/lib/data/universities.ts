/**
 * The North American university vocabulary, and the only sanctioned way to reach it.
 *
 * Nothing imports `universities.json` directly. It is 650 KB — over half the size of
 * the rest of the client bundle — and a static import anywhere in the module graph
 * would put it in the entry chunk, paying for it on the login page. `loadUniversities`
 * hides it behind a dynamic `import()` so the cost lands only when a question that
 * actually uses the list renders.
 *
 * Regenerate with `npm run data:universities`. See `README.md` in this directory for
 * the sources and their licences.
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
	 * Other names the institution is known by — `UT Austin`, `Texas A&M University`.
	 *
	 * Present on about a third of US rows and the reason search works at all: the
	 * dataset stores `The University of Texas at Austin`, and nobody types that.
	 */
	aliases?: string[];
}

/**
 * Cached across calls, not because the dynamic import is slow the second time — the
 * bundler memoizes that — but because parsing 650 KB of JSON is not free, and the
 * editor's preview pane and the applicant form can both ask within one navigation.
 */
let cached: Promise<UniversityData> | null = null;

export function loadUniversities(): Promise<UniversityData> {
	cached ??= import('./universities.json').then((module) => module.default as UniversityData);
	return cached;
}

/**
 * How an institution reads in the dropdown.
 *
 * Location is here to separate the six `Columbia College`s and the four
 * `Trinity College`s, so it earns its place only when it distinguishes: a US row
 * shows `City, ST` and drops the country, since a list this parochial is read as
 * American by default and " — United States" on six thousand rows is noise.
 */
export function universityLabel(university: University, countries: Record<string, string>): string {
	const country = countries[university.country] ?? university.country;
	const where =
		university.country === 'US'
			? [university.city, university.region].filter(Boolean).join(', ')
			: [university.region, country].filter(Boolean).join(', ');

	return where ? `${university.name} — ${where}` : university.name;
}
