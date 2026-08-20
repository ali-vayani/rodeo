#!/usr/bin/env node
/**
 * Rebuilds `src/lib/data/universities.json`, the vocabulary behind the University
 * linked field.
 *
 * Two sources, because no single one answers both halves. IPEDS is the US Department
 * of Education's register, so it has every accredited US institution and a real
 * address for each, but stops at the US border. Hipo's list crosses the border but
 * carries only a country code. So IPEDS for the US, Hipo for the rest of North America.
 *
 * The output is committed: builds must not depend on two third-party hosts, and a
 * dataset that silently changed would move the ground `assertAnswerValid` stands on.
 * Re-run deliberately with `npm run data:universities`, then read the diff. A large
 * drop in row count means a source moved, not that hundreds of colleges closed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'src/lib/data/universities.json');

/**
 * IPEDS "Institutional Characteristics" directory file. Pinned to a year rather than
 * tracking "latest" so a rebuild is reproducible.
 */
const IPEDS_URL = 'https://nces.ed.gov/ipeds/datacenter/data/HD2023.zip';

const HIPO_URL =
	'https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json';

/**
 * North America, as ISO 3166-1 alpha-2, minus the US.
 *
 * The US is absent because IPEDS covers it, including Puerto Rico and the US Virgin
 * Islands. Taking those from Hipo too would duplicate every San Juan campus.
 */
const HIPO_COUNTRIES = {
	CA: 'Canada',
	MX: 'Mexico',
	GT: 'Guatemala',
	BZ: 'Belize',
	SV: 'El Salvador',
	HN: 'Honduras',
	NI: 'Nicaragua',
	CR: 'Costa Rica',
	PA: 'Panama',
	CU: 'Cuba',
	DO: 'Dominican Republic',
	HT: 'Haiti',
	JM: 'Jamaica',
	TT: 'Trinidad and Tobago',
	BS: 'Bahamas',
	BB: 'Barbados',
	AG: 'Antigua and Barbuda',
	GD: 'Grenada',
	LC: 'Saint Lucia',
	VC: 'Saint Vincent and the Grenadines',
	KN: 'Saint Kitts and Nevis',
	DM: 'Dominica',
	AW: 'Aruba',
	CW: 'Curaçao',
	BM: 'Bermuda',
	GL: 'Greenland',
	KY: 'Cayman Islands',
	TC: 'Turks and Caicos Islands'
};

/**
 * US-flagged IPEDS rows that are not in North America.
 *
 * The Pacific territories are US for statistical purposes and Oceania for geographic
 * ones. Eight rows, dropped so "North America only" is true rather than nearly true.
 */
const PACIFIC = new Set(['AS', 'GU', 'MP', 'FM', 'MH', 'PW']);

/** Minimal RFC 4180 reader. IPEDS quotes any field containing a comma. */
function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;

	function endField() {
		row.push(field);
		field = '';
	}

	function endRow() {
		endField();
		rows.push(row);
		row = [];
	}

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') quoted = true;
		else if (char === ',') endField();
		else if (char === '\n') endRow();
		else if (char !== '\r') field += char;
	}
	if (field !== '' || row.length > 0) endRow();

	const [header, ...body] = rows;
	return body
		.filter((r) => r.length === header.length)
		.map((r) => Object.fromEntries(header.map((key, index) => [key.trim(), r[index]])));
}

/**
 * IPEDS's alias column, which has no agreed separator.
 *
 * Across the 2,195 rows that have one, entries are divided by `|`, by a comma, by a run
 * of spaces, or by nothing at all. An unsplit alias is still a usable haystack for
 * prefix and substring matching, whereas guessing at word boundaries would invent
 * aliases nobody uses.
 */
function parseAliases(raw, name) {
	if (!raw || raw.trim() === '' || raw.trim() === '-2') return [];

	const seen = new Set([name.toLowerCase()]);
	const out = [];

	for (const part of raw.split(/\s*\|\s*|\s*,\s*|\s{2,}/)) {
		const alias = part.trim();
		if (!alias || seen.has(alias.toLowerCase())) continue;
		seen.add(alias.toLowerCase());
		out.push(alias);
	}
	return out;
}

async function fetchIpeds() {
	const response = await fetch(IPEDS_URL);
	if (!response.ok) throw new Error(`IPEDS ${response.status} — ${IPEDS_URL}`);

	// `unzip` rather than a zip library: this is a hand-run maintenance script, and
	// the alternative is hand-rolling a central-directory parser to read one member.
	const dir = mkdtempSync(join(tmpdir(), 'ipeds-'));
	try {
		const zip = join(dir, 'hd.zip');
		writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
		// IPEDS ships Latin-1, not UTF-8; decoding as UTF-8 mangles every "ñ".
		const csv = execFileSync('unzip', ['-p', zip], { maxBuffer: 64 << 20 }).toString('latin1');

		return parseCsv(csv)
			.filter((row) => row.CYACTIVE === '1' && !PACIFIC.has(row.STABBR))
			.map((row) => ({
				name: row.INSTNM.trim(),
				city: row.CITY.trim(),
				region: row.STABBR.trim(),
				country: 'US',
				aliases: parseAliases(row.IALIAS, row.INSTNM.trim())
			}));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function fetchHipo() {
	const response = await fetch(HIPO_URL);
	if (!response.ok) throw new Error(`Hipo ${response.status} — ${HIPO_URL}`);

	return (await response.json())
		.filter((row) => row.alpha_two_code in HIPO_COUNTRIES)
		.map((row) => ({
			name: row.name.trim(),
			// Populated on roughly a tenth of Hipo's rows; omitted rather than blank so
			// `universityLabel` can fall back to the country without a truthiness dance.
			region: row['state-province']?.trim() || undefined,
			country: row.alpha_two_code,
			aliases: []
		}));
}

const [ipeds, hipo] = await Promise.all([fetchIpeds(), fetchHipo()]);

/**
 * Deduplicate by name, first source wins.
 *
 * The two sources cannot overlap by construction, so this only catches duplicates
 * within a source. IPEDS lists a handful of institutions twice under one name.
 */
const byName = new Map();
for (const entry of [...ipeds, ...hipo]) {
	if (entry.name && !byName.has(entry.name)) byName.set(entry.name, entry);
}

const universities = [...byName.values()]
	.sort((a, b) => a.name.localeCompare(b.name, 'en'))
	.map(({ name, city, region, country, aliases }) => ({
		name,
		...(city ? { city } : {}),
		...(region ? { region } : {}),
		country,
		...(aliases.length ? { aliases } : {})
	}));

mkdirSync(join(ROOT, 'src/lib/data'), { recursive: true });
// The code-to-name map travels with the rows so the display label has one source. An
// ISO table hand-kept in `universities.ts` would be the same 27 lines written twice.
writeFileSync(
	OUT,
	JSON.stringify({ countries: { US: 'United States', ...HIPO_COUNTRIES }, universities }) + '\n'
);

const dropped = ipeds.length + hipo.length - universities.length;
console.log(
	`✓ ${universities.length} universities → src/lib/data/universities.json ` +
		`(${ipeds.length} IPEDS, ${hipo.length} Hipo, ${dropped} duplicate name(s) dropped)`
);
