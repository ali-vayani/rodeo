/**
 * Where a question's choices come from, and which answers it will accept.
 *
 * The applicant's renderer, the editor's preview, `assertAnswerValid` and the facet
 * builder all route through here, so they cannot disagree.
 */

import type { OptionPreset, Question, QuestionType } from '$lib/generated/prisma/client';

/** The shape any of the four callers can supply: their selects differ, this doesn't. */
type OptionBearing = Pick<Question, 'type' | 'optionPreset'>;

/** Plus the write-in opt-in, which only `acceptsWriteIn` and its callers need. */
type WriteInBearing = OptionBearing & Pick<Question, 'allowOther'>;

/**
 * Question types whose answer is exactly one of a fixed set rather than free text.
 *
 * MULTI_SELECT is deliberately absent: its answer is an encoded set, so every caller
 * here — preset lookup, write-in policy, the `options.includes(value)` check — would
 * be reading a JSON array as if it were one option. It has its own branch at each.
 */
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
 * The question takes answers that are not in its list.
 *
 * True for a preset: the university preset is 6,447 institutions, which is not every
 * institution, so rejecting a write-in would block an applicant over a gap in a
 * third-party dataset. Otherwise only when the organizer asked for it with
 * `allowOther`, which is what renders the "Other" row. Hand-authored options stay
 * strict by default — four typed choices usually mean exactly those four.
 */
export function acceptsWriteIn(question: WriteInBearing): boolean {
	if (hasPresetOptions(question)) return true;
	// `=== true` rather than truthiness: a caller with a narrower select leaves the
	// column `undefined`, and the safe reading of "don't know" is the strict one.
	return question.allowOther === true && isOptionsType(question.type);
}

/** Presets that resolve to a bundled list. Keyed by the Prisma enum. */
export const OPTION_PRESET_LABEL = {
	UNIVERSITIES_NA: 'North American universities'
} as const satisfies Record<OptionPreset, string>;
