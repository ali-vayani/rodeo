/**
 * Shared shapes and math for rubric scoring. The server computes the saved total from
 * these same helpers, so the modal's live preview and the stored score cannot drift.
 */

export type RubricLevel = {
	id: string;
	label: string;
	description: string;
	points: number;
	order: number;
};

export type RubricCriterion = {
	id: string;
	title: string;
	order: number;
	levels: RubricLevel[];
};

/** Best possible rubric total: the highest level of every criterion. */
export function rubricMaxScore(criteria: RubricCriterion[]): number {
	return criteria.reduce((sum, c) => sum + Math.max(0, ...c.levels.map((l) => l.points)), 0);
}

/** Sum of the picked levels' points. Criteria without a pick contribute nothing. */
export function rubricSubtotal(
	criteria: RubricCriterion[],
	selections: Record<string, string | undefined>
): number {
	return criteria.reduce((sum, c) => {
		const level = c.levels.find((l) => l.id === selections[c.id]);
		return sum + (level?.points ?? 0);
	}, 0);
}

/** Whether every criterion has a picked level — the gate on saving a rubric score. */
export function rubricComplete(
	criteria: RubricCriterion[],
	selections: Record<string, string | undefined>
): boolean {
	return criteria.every((c) => c.levels.some((l) => l.id === selections[c.id]));
}

/** Bound on the reviewer's manual adjustment, mirrored in the server's input schema. */
export const MAX_DELTA = 1000;

/** Editor rows: `id` present on rows Prisma returned, absent on freshly added ones. */
export type LevelDraft = {
	id?: string;
	label: string;
	description: string;
	points: number | undefined;
};

export type CriterionDraft = { id?: string; title: string; levels: LevelDraft[] };
