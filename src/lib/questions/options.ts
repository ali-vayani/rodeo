/**
 * Where a question's choices come from, and which answers it will accept.
 *
 * The applicant's renderer, the editor's preview, `assertAnswerValid` and the facet
 * builder all route through here, so they cannot disagree.
 */

import type { OptionPreset, Question, QuestionType } from '$lib/generated/prisma/client';

/** The shape any of the four callers can supply: their selects differ, this doesn't. */
type OptionBearing = Pick<Question, 'type' | 'optionPreset'>;

/** Question types that offer a fixed set of answers rather than free text. */
export function isOptionsType(type: QuestionType): boolean {
	return type === 'MULTIPLE_CHOICE' || type === 'DROPDOWN';
}

/**
 * The choices come from a bundled dataset, and `Question.options` is ignored.
 * Checked independently of `type`, since a preset left behind by switching to Short
 * Text would otherwise keep applying.
 */
export function hasPresetOptions(question: OptionBearing): boolean {
	// `!= null`, not `!== null`: a caller projecting a narrower select can leave the field
	// off entirely, and treating `undefined` as "has a preset" makes `assertAnswerValid`
	// fail open.
	return question.optionPreset != null && isOptionsType(question.type);
}

/**
 * A preset-backed question takes answers that are not in its list.
 *
 * The university preset is 6,447 institutions, which is not every institution, so
 * rejecting a write-in would block an applicant over a gap in a third-party dataset.
 * Hand-authored `options` stay strict.
 */
export function acceptsWriteIn(question: OptionBearing): boolean {
	return hasPresetOptions(question);
}

/** Presets that resolve to a bundled list. Keyed by the Prisma enum. */
export const OPTION_PRESET_LABEL = {
	UNIVERSITIES_NA: 'North American universities'
} as const satisfies Record<OptionPreset, string>;
