/**
 * US states and territories, as the `region` codes `universities.json` carries.
 *
 * Hand-written rather than generated: it is 56 rows that have not changed since 1959,
 * and the university dataset's generator has no state table of its own to derive it
 * from. Small enough to be a static import anywhere — unlike `universities.json`,
 * which is 650 KB behind a lazy `import()`.
 *
 * Isomorphic: the Settings picker reads it in the browser, the state facet reads it on
 * the server. Keep it free of Prisma, node builtins and `$env`.
 */
export const US_STATES: Record<string, string> = {
	AL: 'Alabama',
	AK: 'Alaska',
	AZ: 'Arizona',
	AR: 'Arkansas',
	CA: 'California',
	CO: 'Colorado',
	CT: 'Connecticut',
	DE: 'Delaware',
	DC: 'District of Columbia',
	FL: 'Florida',
	GA: 'Georgia',
	HI: 'Hawaii',
	ID: 'Idaho',
	IL: 'Illinois',
	IN: 'Indiana',
	IA: 'Iowa',
	KS: 'Kansas',
	KY: 'Kentucky',
	LA: 'Louisiana',
	ME: 'Maine',
	MD: 'Maryland',
	MA: 'Massachusetts',
	MI: 'Michigan',
	MN: 'Minnesota',
	MS: 'Mississippi',
	MO: 'Missouri',
	MT: 'Montana',
	NE: 'Nebraska',
	NV: 'Nevada',
	NH: 'New Hampshire',
	NJ: 'New Jersey',
	NM: 'New Mexico',
	NY: 'New York',
	NC: 'North Carolina',
	ND: 'North Dakota',
	OH: 'Ohio',
	OK: 'Oklahoma',
	OR: 'Oregon',
	PA: 'Pennsylvania',
	RI: 'Rhode Island',
	SC: 'South Carolina',
	SD: 'South Dakota',
	TN: 'Tennessee',
	TX: 'Texas',
	UT: 'Utah',
	VT: 'Vermont',
	VA: 'Virginia',
	WA: 'Washington',
	WV: 'West Virginia',
	WI: 'Wisconsin',
	WY: 'Wyoming',
	AS: 'American Samoa',
	GU: 'Guam',
	MP: 'Northern Mariana Islands',
	PR: 'Puerto Rico',
	VI: 'US Virgin Islands'
};

/** How a state code is written where a person reads it; the code itself if unknown. */
export function stateName(code: string): string {
	return US_STATES[code] ?? code;
}

export function isStateCode(code: string | null | undefined): code is string {
	return code != null && code in US_STATES;
}
