/**
 * The application questions that write through to a `User` column.
 *
 * The facet contract these feed — and which every other question feeds alongside them
 * — lives in `$lib/facets`. This module is only the `User`-column half.
 *
 * A question carrying a `linkedField` is the single definition of both the data and
 * the control that filters it: `application.save` writes the answer into the named
 * `User` column, and the admin filter panels render a control chosen from that same
 * question's `type`. Change Year from a dropdown to short text in the editor and its
 * filter follows, because nothing here hardcodes which field gets which control.
 *
 * Deliberately isomorphic — imported by the filter UI (browser) and by the routers
 * that build the Prisma predicate (server). Keep it free of Prisma, node builtins
 * and `$env`. The Prisma imports below are `import type`, which erases at build.
 */

import type { LinkedField, User } from '$lib/generated/prisma/client';

/**
 * Every linked field there is.
 *
 * Restated here rather than derived from the generated Prisma enum object, because
 * that would be a value import and this module is loaded in the browser. The
 * `satisfies` against the type-only import is what keeps the two in step: the import
 * erases at build, but adding a member to the Prisma enum without adding it here is
 * a compile error.
 *
 * This was `['name', 'university', 'year']`, doing double duty as both the set of
 * fields and the `User` column names — which is why it could not become an enum
 * without also renaming a database column. `LINKED_FIELD_COLUMN` splits the two.
 */
export const LINKED_FIELDS = [
	'NAME',
	'UNIVERSITY',
	'YEAR'
] as const satisfies readonly LinkedField[];

export type { LinkedField };

/**
 * The `User` column each linked field writes through to.
 *
 * The allowlist for a computed property assignment into a Prisma `update`, so it
 * must stay a closed set — a `Record<LinkedField, string>` typed loosely enough to
 * accept any column name would let a question write to `role`.
 */
export const LINKED_FIELD_COLUMN = {
	NAME: 'name',
	UNIVERSITY: 'university',
	YEAR: 'year'
} as const satisfies Record<LinkedField, keyof Pick<User, 'name' | 'university' | 'year'>>;

/** How a linked field is written where a person reads it. */
export const LINKED_FIELD_LABEL = {
	NAME: 'Name',
	UNIVERSITY: 'University',
	YEAR: 'Year'
} as const satisfies Record<LinkedField, string>;

/**
 * The linked fields that get a filter control, which is not all of them.
 *
 * `NAME` is deliberately absent. It is a linked field like the others — the predicate
 * accepts `names`, and the search box's suggestion chips set it — but it has one
 * distinct value per person, so a list of them is a directory rather than a
 * vocabulary. Picking a hackathon's applicants out of ~1,900 names by scrolling is not
 * a filter; typing the name is, and the typo-tolerant search box already does that.
 *
 * So this governs which **facets** are offered, never which fields the predicate
 * accepts — `names` stays fully functional, and removing the control does not remove
 * the filter.
 */
export const FILTERABLE_LINKED_FIELDS = ['UNIVERSITY', 'YEAR'] as const satisfies readonly [
	...LinkedField[]
];

export function isLinkedField(value: string | null | undefined): value is LinkedField {
	return value != null && (LINKED_FIELDS as readonly string[]).includes(value);
}
