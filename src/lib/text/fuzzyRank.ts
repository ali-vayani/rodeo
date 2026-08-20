/**
 * Ranking for type-ahead over a vocabulary nobody curated.
 *
 * Verbatim beats similar, always: someone who types `texas` expects the substring
 * matches in the order the server sent them, so fuzzy hits are appended after those
 * and never interleaved. But similar still has to show up, because `univercity of
 * texas` contains no substring of anything and the list would otherwise go empty.
 *
 * Scoring is delegated to `$lib/text/similarity`. This module decides policy only.
 */

import { jaroWinkler, normalizeName, tokenMatch } from '$lib/text/similarity';

export interface Rankable {
	value: string;
	/** Display text, when it differs from the stored value. Matched on as well. */
	label?: string;
	/**
	 * Other strings that should find this option, such as an institution's aliases. The
	 * dataset stores `The University of Texas at Austin`, which nobody types. Never
	 * displayed, only matched.
	 */
	keywords?: readonly string[];
}

/**
 * Similarity at or above which an option is offered for a query it does not literally
 * contain.
 *
 * Measured against the university vocabulary. For `univercity of texas` it keeps the
 * three UT campuses at .987 and drops University of Houston at .887. The gap is wide
 * enough that the exact cut hardly matters, only that it sits inside the gap.
 */
export const FUZZY_THRESHOLD = 0.9;

/** Match tiers, highest first. Verbatim always outranks fuzzy — see the module note. */
const TIER_PREFIX = 3;
const TIER_SUBSTRING = 2;
const TIER_FUZZY = 1;
const TIER_NONE = 0;

/**
 * How well a query matches a value once neither literally contains the other.
 *
 * `tokenMatch(...).score` is exactly the number this needs. Scoring end to end does not
 * work: the whole-string comparison is dragged down by words the typist never intended.
 * That score is kept as a floor, which also covers the empty-query case.
 *
 * `best` is deliberately unused. It is the recall signal, right for search and wrong
 * for a type-ahead where one matching word out of four is noise.
 */
function fuzzyScore(query: string, value: string): number {
	return Math.max(jaroWinkler(query, value), tokenMatch(query, value).score);
}

/** Tier plus within-tier score for one candidate. `TIER_NONE` means "don't offer it". */
function scoreOption(normalizedQuery: string, haystacks: readonly string[]): [number, number] {
	let tier = TIER_NONE;
	let score = 0;

	for (const haystack of haystacks) {
		if (haystack.startsWith(normalizedQuery)) return [TIER_PREFIX, 1];
		if (haystack.includes(normalizedQuery) && tier < TIER_SUBSTRING) {
			tier = TIER_SUBSTRING;
			score = 1;
			continue;
		}
		if (tier > TIER_FUZZY) continue;
		const fuzzy = fuzzyScore(normalizedQuery, haystack);
		if (fuzzy >= FUZZY_THRESHOLD && fuzzy > score) {
			tier = TIER_FUZZY;
			score = fuzzy;
		}
	}

	return [tier, score];
}

/**
 * Every option worth showing for `query`, best first.
 *
 * An empty query returns the list untouched, since the server already sorted it by
 * count, and ties inside a tier fall back to that order. Nothing is capped here: a
 * caller that truncates needs a complete list to know how much it truncated.
 */
export function rankOptions<T extends Rankable>(options: readonly T[], query: string): T[] {
	const normalizedQuery = normalizeName(query);

	if (!normalizedQuery) return [...options];

	const scored: { option: T; tier: number; score: number; index: number }[] = [];

	options.forEach((option, index) => {
		// The stored value, the display label and any aliases are all searchable. The "no
		// value" row is only findable by its label, and a university mostly by its alias.
		const haystacks = [normalizeName(option.value)];
		if (option.label !== undefined) haystacks.unshift(normalizeName(option.label));
		for (const keyword of option.keywords ?? []) haystacks.push(normalizeName(keyword));

		const [tier, score] = scoreOption(normalizedQuery, haystacks);
		if (tier === TIER_NONE) return;
		scored.push({ option, tier, score, index });
	});

	scored.sort((a, b) => b.tier - a.tier || b.score - a.score || a.index - b.index);

	return scored.map((entry) => entry.option);
}
