/**
 * The question shape each linked field implies.
 *
 * A linked field already settles how the answer should be collected, and leaving the
 * organizer to work that out separately is how a university ended up asked as free
 * text. Defaults, not constraints: the organizer can still change any of it.
 */

import type { OptionPreset, QuestionType } from '$lib/generated/prisma/client';
import type { LinkedField } from '$lib/linkedFields';

/**
 * Class standing, in the order a reader expects rather than by popularity. Also the
 * declared order the dashboard's Year chart renders in; `prisma/seedShared.ts` imports
 * this so the two cannot drift.
 */
export const YEAR_OPTIONS = [
	'Freshman',
	'Sophomore',
	'Junior',
	'Senior',
	'Graduate',
	'Alumni'
] as const;

export interface LinkedFieldDefault {
	type: QuestionType;
	options: string[];
	optionPreset: OptionPreset | null;
}

export const LINKED_FIELD_DEFAULTS = {
	// One line of text. A dropdown of every name would be a directory, which is the same
	// reason `FILTERABLE_LINKED_FIELDS` gives Name no filter control.
	NAME: { type: 'SHORT_TEXT', options: [], optionPreset: null },
	// 6,447 institutions, so the list cannot live in `Question.options`. Same type as
	// Year, since every dropdown is searchable; only the preset differs.
	UNIVERSITY: { type: 'DROPDOWN', options: [], optionPreset: 'UNIVERSITIES_NA' },
	YEAR: { type: 'DROPDOWN', options: [...YEAR_OPTIONS], optionPreset: null },
	DIETARY_RESTRICTION: { type: 'MULTI_SELECT', options: [], optionPreset: null }
} as const satisfies Record<LinkedField, LinkedFieldDefault>;

/** The shape to apply when a question is linked to `field`. Freshly copied arrays. */
export function defaultsFor(field: LinkedField): LinkedFieldDefault {
	const preset = LINKED_FIELD_DEFAULTS[field];
	return { type: preset.type, options: [...preset.options], optionPreset: preset.optionPreset };
}
