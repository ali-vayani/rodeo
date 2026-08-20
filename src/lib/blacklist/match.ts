/**
 * Blacklist matching. Two signals, deliberately unequal.
 *
 * Email is an identity: exact match on a normalized address, and the only signal
 * carrying an automatic decision. Name is a heuristic: first and last must both match,
 * and a hit only raises a flag for a human. Name matching can afford to be
 * typo-tolerant precisely because it cannot reject anyone on its own.
 *
 * Phonetic algorithms are deliberately not used; they encode English pronunciation and
 * misfire on the international names a hackathon receives. The string algorithms live
 * in `$lib/text/similarity`, re-exported here so existing importers are unaffected.
 */

import { jaroWinkler, normalizeName } from '$lib/text/similarity';

export { jaroWinkler, normalizeName };

/**
 * Jaro-Winkler score at or above which two name components are the same name.
 *
 * 0.92 was picked by measurement. It catches hasan/hassan .961, jhon/john .925 and
 * nguyan/nguyen .933 while rejecting patel/patil .907 and chen/chan .867 — different
 * families, where a flag would be a false positive rather than a catch.
 *
 * Known limitation: transliteration variants (mohammed/muhammad, .850) score too low.
 * Because both components are gated independently, the effective bar for a whole name
 * is higher than this number suggests.
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
 * `User.name` is one field, so this is a guess. `John Q. Doe` and `Maria de la Cruz`
 * both reduce to the pair a person would name if asked. Returns `null` for a
 * single-token name, which has no last name to gate against.
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
 * Normalize the whole blacklist once, so a page listing N applicants folds the M
 * entries once rather than N times.
 */
export function prepareBlacklist(entries: readonly BlacklistEntryLike[]): PreparedBlacklist {
	const emails = new Set<string>();
	const names: { first: string; last: string }[] = [];

	for (const entry of entries) {
		if (entry.email) emails.add(normalizeEmail(entry.email));

		const first = normalizeName(entry.firstName);
		const last = normalizeName(entry.lastName);
		// Half a name identifies nobody. Entries added by email alone store empty strings
		// here, which would otherwise sail past the threshold against every applicant.
		if (first && last) names.push({ first, last });
	}

	return { emails, names };
}

/**
 * Strongest blacklist signal for this applicant, or `null`. Ranked EMAIL >
 * NAME_EXACT > NAME_FUZZY so the caller can render how much to trust it.
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
		// would let a long, exactly-matching surname carry a first name that isn't close.
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
