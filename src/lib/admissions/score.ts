/**
 * The review score scale.
 *
 * Isomorphic on purpose, like `$lib/stats`: the router validates against these
 * bounds and the score input renders them, so the number an admin is allowed to
 * type and the number the server will accept cannot drift apart.
 *
 * Keep it free of Prisma, `$env`, and node builtins.
 */

export const MIN_SCORE = 0;
export const MAX_SCORE = 20;

/** Which half of the scoring queue the review list is showing. */
export type ScoreFilter = 'unscored' | 'scored' | 'all';

/**
 * Whole numbers only, inside the scale.
 *
 * Shared with the input so a rejected keystroke and a rejected mutation agree on
 * what "17.5" is — the browser's `type=number` will happily hand over a float.
 */
export function isValidScore(value: number): boolean {
	return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}
