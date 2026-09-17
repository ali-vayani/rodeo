/**
 * The application questions that write through to a `User` column.
 *
 * A question carrying a `linkedField` defines both the data and the control that
 * filters it: `application.save` writes the answer into the named column, and the
 * filter panels render a control chosen from the question's own `type`.
 *
 * Isomorphic, so keep it free of Prisma, node builtins and `$env`.
 */

import type { LinkedField, User } from '$lib/generated/prisma/client';

/**
 * Every linked field there is. Restated rather than derived from the generated Prisma
 * enum object, which would be a value import in a browser module. The `satisfies`
 * against the type-only import keeps the two in step.
 */
export const LINKED_FIELDS = [
	'NAME',
	'UNIVERSITY',
	'YEAR',
	'DIETARY_RESTRICTION'
] as const satisfies readonly LinkedField[];

export type { LinkedField };

/**
 * The `User` column each *scalar* linked field writes through to, verbatim. The
 * allowlist for a computed property assignment into a Prisma `update`, so it must
 * stay a closed set.
 *
 * DIETARY_RESTRICTION is deliberately absent: it mirrors onto a `User` column too
 * (`dietaryRestriction`), but as a decoded array rather than the raw answer string, so
 * it can't share this map's "write the value straight through" contract — see
 * `application.ts`'s `save`, which mirrors it separately.
 */
export const USER_LINKED_FIELD_COLUMN = {
	NAME: 'name',
	UNIVERSITY: 'university',
	YEAR: 'year'
} as const satisfies Record<
	'NAME' | 'UNIVERSITY' | 'YEAR',
	keyof Pick<User, 'name' | 'university' | 'year'>
>;

/** How a linked field is written where a person reads it. */
export const LINKED_FIELD_LABEL = {
	NAME: 'Name',
	UNIVERSITY: 'University',
	YEAR: 'Year',
	DIETARY_RESTRICTION: 'Dietary restriction'
} as const satisfies Record<LinkedField, string>;

/**
 * The linked fields that get a filter control, which is not all of them.
 *
 * `NAME` is absent: it has one distinct value per person, so a list of them is a
 * directory. This governs which facets are offered, never which fields the predicate
 * accepts, so `names` stays fully functional.
 */
export const FILTERABLE_LINKED_FIELDS = ['UNIVERSITY', 'YEAR'] as const satisfies readonly [
	...LinkedField[]
];

export function isLinkedField(value: string | null | undefined): value is LinkedField {
	return value != null && (LINKED_FIELDS as readonly string[]).includes(value);
}

/**
 * True only for links that mirror an answer into a *scalar* User column. False for
 * DIETARY_RESTRICTION, which mirrors into an array column through its own path
 * instead — see `USER_LINKED_FIELD_COLUMN`.
 */
export function isUserLinkedField(
	value: string | null | undefined
): value is keyof typeof USER_LINKED_FIELD_COLUMN {
	return value != null && value in USER_LINKED_FIELD_COLUMN;
}
