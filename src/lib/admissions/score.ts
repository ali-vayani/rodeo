export const MIN_SCORE = 0;
export const MAX_SCORE = 20;

export type ScoreFilter = 'unscored' | 'scored' | 'all';

export function isValidScore(value: number): boolean {
	return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}
