/**
 * Ranking for type-ahead over a vocabulary nobody curated.
 *
 * A `combobox` facet's options are whatever applicants typed into a short-text
 * question, so the list is long, inconsistently spelled, and full of near-duplicates
 * (`The University of Texas at Austin` and `University of Texas at Austin` are two
 * separate rows an organizer usually wants both of). Two consequences:
 *
 *   - **Verbatim beats similar, always.** An organizer who types `texas` is not
 *     asking a question about edit distance; they typed a substring and expect the
 *     substring matches, in the order the server sent them. Fuzzy hits are appended
 *     *after* those, never interleaved, so typing more characters can only ever
 *     narrow what is at the top.
 *   - **Similar still has to show up.** `univercity of texas` is a plausible thing
 *     to type and contains no substring of anything. Without a fuzzy tier the list
 *     goes empty and the organizer concludes the filter is broken.
 *
 * Scoring is delegated entirely to `$lib/text/similarity` — this module decides
 * *policy* (which tier, what threshold, how ties break) and owns no algorithm.
 */

import { jaroWinkler, normalizeName, tokenMatch } from '$lib/text/similarity';

export interface Rankable {
	value: string;
	/** Display text, when it differs from the stored value. Matched on as well. */
	label?: string;
}

/**
 * Similarity at or above which an option is offered for a query it does not
 * literally contain.
 *
 * Measured against the university vocabulary rather than chosen by feel. For the
 * query `univercity of texas`:
 *
 *   keeps    University of Texas at Austin .987   …at Dallas .987   …at Arlington .987
 *   drops    University of Houston .887   Texas A&M University .653   Rice University .696
 *
 * The gap between .887 and .987 is wide enough that the exact cut hardly matters;
 * what matters is that it sits inside the gap. Lower and every school with the word
 * "university" in it floods the list, which for a filter is worse than no
 * suggestion at all — the organizer cannot tell which rows are real.
 */
export const FUZZY_THRESHOLD = 0.9;

/** Match tiers, highest first. Verbatim always outranks fuzzy — see the module note. */
const TIER_PREFIX = 3;
const TIER_SUBSTRING = 2;
const TIER_FUZZY = 1;
const TIER_NONE = 0;

/**
 * How well a query matches a value once neither one literally contains the other.
 *
 * `tokenMatch(...).score` is exactly the number this needs: the mean of the
 * per-query-token bests, each token measured against the value's tokens *and* the
 * whole value. Scoring end to end instead does not work —
 * `jaroWinkler('univercity of texas', 'the university of texas at austin')` is
 * dragged down to .68 by the words the typist never intended to type, while the
 * words they did type score .95, 1.0 and 1.0 against their counterparts.
 *
 * The whole-string score is kept as a floor so nothing scores worse here than plain
 * Jaro-Winkler would — which is also what covers the empty-query case, where
 * `tokenMatch` has no tokens to average and returns 0.
 *
 * `best` is deliberately unused: it is the *recall* signal, right for search (one
 * convincing token match is worth a suggestion) and wrong for a type-ahead over a
 * list the organizer is reading, where one matching word out of four is noise.
 * Thresholding on the mean is what keeps `FUZZY_THRESHOLD` meaningful.
 *
 * Both sides are assumed normalized.
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
 * An empty query returns the list untouched — the server already sorted it by count,
 * and reordering an unfiltered list would hide the very thing counts are there to
 * show. Ties inside a tier also fall back to that order, so the 408-user spelling of
 * a university sits above the 120-user one without this module knowing counts exist.
 *
 * Nothing is capped here. How many rows fit on a screen is the caller's decision, and
 * a caller that truncates needs to know how much it truncated — which it can only work
 * out from a complete list.
 */
export function rankOptions<T extends Rankable>(options: readonly T[], query: string): T[] {
	const normalizedQuery = normalizeName(query);

	if (!normalizedQuery) return [...options];

	const scored: { option: T; tier: number; score: number; index: number }[] = [];

	options.forEach((option, index) => {
		// Both the stored value and the display label are searchable: the "no value"
		// row is stored as a sentinel nobody would ever type, and is only findable by
		// its label.
		const haystacks =
			option.label === undefined
				? [normalizeName(option.value)]
				: [normalizeName(option.label), normalizeName(option.value)];

		const [tier, score] = scoreOption(normalizedQuery, haystacks);
		if (tier === TIER_NONE) return;
		scored.push({ option, tier, score, index });
	});

	scored.sort((a, b) => b.tier - a.tier || b.score - a.score || a.index - b.index);

	return scored.map((entry) => entry.option);
}
