/**
 * The question shape each linked field implies.
 *
 * A linked field is a claim about what an answer *is*, and that claim already settles
 * how the answer should be collected: a class standing is one of six values, a
 * university is one of six thousand, a name is a line of text. Leaving the organizer
 * to work that out separately is how the seeded form ended up asking for a university
 * as free text — which is why `$lib/linkedFields` has to describe that filter facet as
 * a combobox over "an unauthoritative vocabulary", and why the same school arrives
 * under four spellings.
 *
 * These are defaults, not constraints. Attaching a field applies them; the organizer
 * can then change the type, edit the options, or drop the preset. Nothing downstream
 * assumes a linked question kept its default shape.
 */

import type { OptionPreset, QuestionType } from '$lib/generated/prisma/client';
import type { LinkedField } from '$lib/linkedFields';

/**
 * Class standing, in the order a reader expects rather than by popularity.
 *
 * Also the declared order the dashboard's Year chart renders in — see the comment in
 * `dashboard.demographics`. `prisma/seed.ts` imports this rather than keeping the copy
 * it used to own, so the seeded form and the editor's default cannot drift.
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
	// One line of text. A dropdown of every name would be a directory, which is the
	// same reason `FILTERABLE_LINKED_FIELDS` gives Name no filter control.
	NAME: { type: 'SHORT_TEXT', options: [], optionPreset: null },
	// 6,447 institutions, so the list cannot live in `Question.options`. Same type as
	// Year — every dropdown is searchable — and only the preset differs.
	UNIVERSITY: { type: 'DROPDOWN', options: [], optionPreset: 'UNIVERSITIES_NA' },
	YEAR: { type: 'DROPDOWN', options: [...YEAR_OPTIONS], optionPreset: null }
} as const satisfies Record<LinkedField, LinkedFieldDefault>;

/** The shape to apply when a question is linked to `field`. Freshly copied arrays. */
export function defaultsFor(field: LinkedField): LinkedFieldDefault {
	const preset = LINKED_FIELD_DEFAULTS[field];
	return { type: preset.type, options: [...preset.options], optionPreset: preset.optionPreset };
}
