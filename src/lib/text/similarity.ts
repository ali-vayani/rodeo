/**
 * String similarity primitives. Nothing here knows what it is comparing.
 *
 * The algorithm moved out of `$lib/blacklist/match`; every policy stayed behind,
 * because "how similar is similar enough" is a question about consequences. Isomorphic
 * and dependency-free.
 */

/** Jaro score below which Winkler's prefix bonus is not applied, per the standard definition. */
const WINKLER_BOOST_THRESHOLD = 0.7;

/**
 * Fold a name to a comparable form. This step, not the edit distance below, does most
 * of the work: it collapses `José`/`Jose`, `O'Brien`/`OBrien` and `JAY PATIL`/`Jay
 * Patil` before any fuzziness is needed.
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
 * Jaro similarity: matched characters within a sliding window, discounted by how many of
 * those matches appear out of order.
 */
export function jaro(a: string, b: string): number {
	if (a === b) return 1;
	if (!a.length || !b.length) return 0;

	// Two characters match only if they sit within this many positions of each other,
	// which keeps the metric from degenerating into a bag-of-characters comparison.
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
 * Jaro-Winkler: Jaro, with a bonus for a shared prefix. Preferred over raw edit
 * distance because it is length-normalized — one wrong character matters far more in
 * `Ann` than in `Bartholomew` — and names are misspelled toward their ends.
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

/**
 * How well a multi-word query matches a multi-word value, token by token.
 *
 * Comparing the strings whole fails both ways. `jaroWinkler('sarh', 'sarah chen')` is
 * dragged down by the half the typist never meant to type, while comparing the query
 * whole against each name token scores `harsh` at .808 and `chen` near zero, which is
 * how `Sarh Chn` surfaced eleven `Harsh *` users and no `Chen`.
 *
 * So each query token is matched independently against the value's tokens, and against
 * the whole value so a query typed without spaces still lands. Both sides are assumed
 * already normalized by `normalizeName`.
 */
export interface TokenMatch {
	/** Mean of the per-query-token bests. Ranks candidates; do not threshold on it. */
	score: number;
	/** The strongest single query-token match. Decides whether a candidate qualifies. */
	best: number;
}

export function tokenMatch(query: string, value: string): TokenMatch {
	const queryTokens = query.split(' ').filter(Boolean);
	if (queryTokens.length === 0) return { score: 0, best: 0 };
	const valueTokens = value.split(' ').filter(Boolean);

	let total = 0;
	let best = 0;
	for (const q of queryTokens) {
		// The whole value is a candidate alongside its tokens, so `sarahchen` still
		// matches `Sarah Chen` even though neither token resembles it.
		let tokenBest = jaroWinkler(q, value);
		for (const v of valueTokens) {
			const score = jaroWinkler(q, v);
			if (score > tokenBest) tokenBest = score;
		}
		total += tokenBest;
		if (tokenBest > best) best = tokenBest;
	}

	return { score: total / queryTokens.length, best };
}

/**
 * Best match between a single-word query and any part of a multi-word value. Exactly
 * `tokenMatch(...).best`; multi-word callers want `tokenMatch`.
 */
export function bestTokenScore(query: string, value: string): number {
	return tokenMatch(query, value).best;
}
