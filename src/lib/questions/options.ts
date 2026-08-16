/**
 * Where a question's choices come from, and which answers it will accept.
 *
 * Four places need this answer and used to each decide it inline: the applicant's
 * renderer, the editor's preview pane, the server's `assertAnswerValid`, and the
 * filter facet builder. They agreed by coincidence, which held right up until a
 * question type was added. Routing all four through here is what makes "the preview
 * shows what the form shows, and the server accepts what the form offered" a
 * property rather than a habit.
 *
 * Isomorphic — server and browser both import it. Type-only Prisma imports, as in
 * `$lib/linkedFields`.
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
 *
 * Note this is checked independently of `type`: a preset left behind by switching a
 * question from Searchable Dropdown to Short Text would otherwise keep applying. The
 * editor clears it on the way out; this is the belt to that braces.
 */
export function hasPresetOptions(question: OptionBearing): boolean {
	// `!= null`, not `!== null`: Prisma returns `null` for an unset column, but a
	// caller projecting a narrower select can leave the field off entirely. Treating
	// `undefined` as "has a preset" would take a hand-authored dropdown out of
	// `assertAnswerValid`'s membership check, which is the check failing open.
	return question.optionPreset != null && isOptionsType(question.type);
}

/**
 * A preset-backed question takes answers that are not in its list.
 *
 * The university preset is 6,447 institutions, which is not every institution. An
 * applicant at a school it missed picks "My school isn't listed" and types their own,
 * and rejecting that here would hard-block them from applying over a gap in a
 * third-party dataset. So the preset is a vocabulary, not a constraint — organizers
 * see the write-ins in the filter facet like any other observed value.
 *
 * Hand-authored `options` stay strict. An organizer who typed four choices meant
 * exactly those four.
 */
export function acceptsWriteIn(question: OptionBearing): boolean {
	return hasPresetOptions(question);
}

/** Presets that resolve to a bundled list. Keyed by the Prisma enum. */
export const OPTION_PRESET_LABEL = {
	UNIVERSITIES_NA: 'North American universities'
} as const satisfies Record<OptionPreset, string>;
