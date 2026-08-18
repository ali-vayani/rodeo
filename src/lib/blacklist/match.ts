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
 *
 * The string algorithms themselves live in `$lib/text/similarity` — they are generic and
 * a second caller (typo-tolerant recipient search) now uses them. The *threshold* stayed
 * here, because it is a policy about what a blacklist flag costs, not a property of
 * Jaro-Winkler. Both are re-exported so existing importers of this module are unaffected.
 */

import { jaroWinkler, normalizeName } from '$lib/text/similarity';

export { jaroWinkler, normalizeName };

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
