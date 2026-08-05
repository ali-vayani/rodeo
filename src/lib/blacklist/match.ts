/**
 * Blacklist matching.
 *
 * Two signals, deliberately unequal:
 *
 *   - **Email** is an identity. Exact match on a normalized address, and the only signal
 *     that carries an automatic decision (`application.submit` sets REJECTED).
 *   - **Name** is a heuristic. First *and* last must both match, verbatim or within a
 *     typo, and a hit only raises a flag for a human reviewer.
 *
 * Name matching can afford to be typo-tolerant precisely because it cannot reject anyone
 * on its own. Were it wired to a decision, the false-positive rate would be unacceptable.
 *
 * Phonetic algorithms (Soundex, Metaphone) are deliberately not used: they encode English
 * pronunciation rules and misfire badly on the international names a hackathon actually
 * receives. Unicode normalization plus edit-distance covers the realistic typo cases
 * without that bias.
 */

/**
 * Jaro-Winkler score at or above which two name components are treated as the same name.
 *
 * 0.92 was picked by measurement, not feel: it lands in the gap between "typo" and
 * "different surname that happens to look similar".
 *
 *   catches  hasan/hassan .961  jhon/john .925  garca/garcia .967  nguyan/nguyen .933
 *   rejects  patel/patil .907   chen/chan .867  smyth/smith .893   stephens/stevens .908
 *
 * That second row is the important one. Patel and Patil are different families, as are
 * Chen and Chan -- flagging across them would be a false positive, not a catch. Lowering
 * the bar to sweep them in would cost far more than it gained.
 *
 * Known limitation: transliteration variants (`mohammed`/`muhammad`, .850) score too low
 * to match. Catching those needs phonetic encoding, which is rejected above for producing
 * worse errors than it fixes on this applicant population.
 *
 * Because both components are gated independently, the effective bar for flagging a whole
 * name is considerably higher than this number suggests on its own.
 */
export const NAME_SIMILARITY_THRESHOLD = 0.92;

/** Jaro score below which Winkler's prefix bonus is not applied, per the standard definition. */
const WINKLER_BOOST_THRESHOLD = 0.7;

export type BlacklistMatch = 'EMAIL' | 'NAME_EXACT' | 'NAME_FUZZY';

/** The fields of a `Blacklist` row that matching actually reads. */
export interface BlacklistEntryLike {
	firstName: string;
	lastName: string;
	email: string | null;
}

/** The fields of a `User` row that matching actually reads. */
export interface ApplicantLike {
	name: string;
	email: string;
}

/** Trim and lowercase so the unique index and every comparison agree on one form. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Fold a name to a comparable form.
 *
 * This step, not the edit-distance below, does most of the real work: it collapses
 * `José`/`Jose`, `O'Brien`/`O’Brien`/`OBrien`, `Smith-Jones`/`SmithJones` and
 * `JAY PATIL`/`Jay Patil` to identical strings for free, before any fuzziness is needed.
 */
export function normalizeName(value: string): string {
	return (
		value
			// NFKD splits an accented character into its base plus a combining mark, which the
			// next line then discards -- the cheapest way to make é and e compare equal.
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			// Punctuation inside names is presentational and inconsistently typed.
			.replace(/['’`.\-_]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * Split a single free-text name into the first and last token.
 *
 * `User.name` is one field, so this is a guess, and the first/last token rule is the
 * guess that is right most often: `John Doe`, `John Q. Doe` and `Maria de la Cruz` all
 * reduce to the pair a person would name if asked.
 *
 * Returns `null` for a single-token name (`Adam`), which carries no last name to gate
 * against and would otherwise match far too broadly.
 */
export function splitName(fullName: string): { first: string; last: string } | null {
	const parts = normalizeName(fullName).split(' ').filter(Boolean);
	if (parts.length < 2) return null;
	return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * Jaro similarity: matched characters within a sliding window, discounted by how many of
 * those matches appear out of order.
 */
function jaro(a: string, b: string): number {
	if (a === b) return 1;
	if (!a.length || !b.length) return 0;

	// Two characters count as matching only if they sit within this many positions of
	// each other, which is what keeps the metric sensitive to position rather than
	// degenerating into a bag-of-characters comparison.
	const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
	const aMatched = new Array<boolean>(a.length).fill(false);
	const bMatched = new Array<boolean>(b.length).fill(false);

	let matches = 0;
	for (let i = 0; i < a.length; i++) {
		const start = Math.max(0, i - window);
		const end = Math.min(i + window + 1, b.length);
		for (let j = start; j < end; j++) {
			if (bMatched[j] || a[i] !== b[j]) continue;
			aMatched[i] = true;
			bMatched[j] = true;
			matches++;
			break;
		}
	}
	if (matches === 0) return 0;

	// Walk both matched subsequences in parallel; each position where they disagree is
	// half a transposition, since a swapped pair shows up as two such disagreements.
	let transpositions = 0;
	let k = 0;
	for (let i = 0; i < a.length; i++) {
		if (!aMatched[i]) continue;
		while (!bMatched[k]) k++;
		if (a[i] !== b[k]) transpositions++;
		k++;
	}
	transpositions /= 2;

	return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/**
 * Jaro-Winkler: Jaro, with a bonus for a shared prefix.
 *
 * Preferred over raw edit distance for names because it is length-normalized -- one wrong
 * character matters far more in `Ann` than in `Bartholomew`, which a flat "distance <= 2"
 * rule cannot express -- and because names are misspelled toward their ends far more
 * often than their beginnings.
 */
export function jaroWinkler(a: string, b: string): number {
	const score = jaro(a, b);
	// Only boost already-plausible pairs, and cap the prefix at 4 characters, so a long
	// shared prefix can't drag a genuinely poor match over the threshold.
	if (score < WINKLER_BOOST_THRESHOLD) return score;

	let prefix = 0;
	while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

	return score + prefix * 0.1 * (1 - score);
}

/** Blacklist folded into the form `matchApplicant` compares against. */
export interface PreparedBlacklist {
	emails: ReadonlySet<string>;
	names: ReadonlyArray<{ first: string; last: string }>;
}

/**
 * Normalize the whole blacklist once.
 *
 * Split out from `matchApplicant` so a page listing N applicants folds the M entries once
 * rather than N times -- the difference between M and N*M normalizations per request.
 */
export function prepareBlacklist(entries: readonly BlacklistEntryLike[]): PreparedBlacklist {
	const emails = new Set<string>();
	const names: { first: string; last: string }[] = [];

	for (const entry of entries) {
		if (entry.email) emails.add(normalizeEmail(entry.email));

		const first = normalizeName(entry.firstName);
		const last = normalizeName(entry.lastName);
		// Half a name identifies nobody. Entries added by email alone store empty strings
		// here, and an empty component would otherwise sail past the threshold against
		// every applicant on the page.
		if (first && last) names.push({ first, last });
	}

	return { emails, names };
}

/**
 * Strongest blacklist signal for this applicant, or `null` if none.
 *
 * Ranked EMAIL > NAME_EXACT > NAME_FUZZY so the caller can render how much to trust it.
 */
export function matchApplicant(
	applicant: ApplicantLike,
	blacklist: PreparedBlacklist
): BlacklistMatch | null {
	if (blacklist.emails.has(normalizeEmail(applicant.email))) return 'EMAIL';

	const applicantName = splitName(applicant.name);
	if (!applicantName) return null;

	let fuzzy = false;
	for (const entry of blacklist.names) {
		if (entry.first === applicantName.first && entry.last === applicantName.last) {
			return 'NAME_EXACT';
		}

		// Both halves must clear the bar independently. A single gate on the joined string
		// would let a long, exactly-matching surname carry a first name that isn't close at
		// all -- which, on a common surname, is most of the room for false positives.
		if (
			!fuzzy &&
			jaroWinkler(entry.first, applicantName.first) >= NAME_SIMILARITY_THRESHOLD &&
			jaroWinkler(entry.last, applicantName.last) >= NAME_SIMILARITY_THRESHOLD
		) {
			// Keep scanning rather than returning: an exact match further down the list
			// outranks this one and should win.
			fuzzy = true;
		}
	}

	return fuzzy ? 'NAME_FUZZY' : null;
}
