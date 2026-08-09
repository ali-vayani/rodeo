import type { PrismaClient } from '$lib/generated/prisma/client';
import { QuestionType } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import {
	FILTERABLE_LINKED_FIELDS,
	MAX_FACET_OPTIONS,
	isLinkedUserField,
	type LinkedFacet,
	type LinkedFacetControl,
	type LinkedFacetOption,
	type LinkedUserField
} from '$lib/linkedFields';

/**
 * The filter vocabulary for the linked application fields.
 *
 * `adminProcedure`, not `portalProcedure`, and the reasoning is worth writing down
 * because the aggregate shape invites the opposite conclusion. The three pages that
 * render these controls — `users`, `admissions`, `email` — are all absent from
 * `ORGANIZER_SECTIONS` in `$lib/auth/permissions`, so an organizer cannot reach any
 * caller of this query. Widening the procedure would grant nothing that is usable and
 * would leak something real: a list of every university in the applicant pool with
 * exact headcounts, which is per-person data in aggregate clothing — at a count of 1
 * it is literally per-person. `adminProcedure` is the documented default for that, and
 * nothing here has a reason to opt out of it.
 */

/** `Question.type`s that enumerate their own answers; everything else is free text. */
function controlFor(type: QuestionType): LinkedFacetControl {
	return type === QuestionType.DROPDOWN || type === QuestionType.MULTIPLE_CHOICE
		? 'select'
		: 'combobox';
}

/** How many users hold each distinct value of a linked column, plus the absent count. */
async function observedValues(
	prisma: Pick<PrismaClient, 'user'>,
	field: LinkedUserField
): Promise<{ counts: Map<string, number>; noneCount: number }> {
	// `groupBy`'s return type is derived from the `by` tuple, which a runtime-chosen
	// column name cannot produce. The set of names is closed by `LINKED_USER_FIELDS`,
	// so the cast erases a type that can't be spelled rather than a check that matters.
	const rows = (await (prisma.user.groupBy as unknown as (args: unknown) => Promise<unknown[]>)({
		by: [field],
		_count: { _all: true }
	})) as ({ _count: { _all: number } } & Record<string, string | null>)[];

	const counts = new Map<string, number>();
	let noneCount = 0;
	for (const row of rows) {
		const value = row[field];
		const count = row._count._all;
		// `''` is absent everywhere: the write-through in `application.save` does not
		// trim, so a blank answer stores an empty string rather than leaving the column
		// NULL, and the two have to be counted as the same thing or "No value" misses
		// half the people it names.
		if (value === null || value === '') noneCount += count;
		else counts.set(value, count);
	}

	return { counts, noneCount };
}

/** Declared options first, then values users hold that the question no longer offers. */
function selectOptions(declared: string[], counts: Map<string, number>): LinkedFacetOption[] {
	// Declared options keep the editor's order, including any with a count of zero: the
	// form offers them, so the filter should too, and reordering by popularity would
	// make the control read differently from the question it filters.
	const options: LinkedFacetOption[] = declared.map((value) => ({
		value,
		count: counts.get(value) ?? 0
	}));

	// Values nobody can pick any more but plenty of people still hold — an option that
	// was renamed or deleted after they answered. Appended rather than interleaved, so
	// the authoritative list stays visually intact and the stragglers are obviously
	// stragglers; most-held first, since that is the order in which they matter.
	const declaredSet = new Set(declared);
	const extras = [...counts.entries()]
		.filter(([value]) => !declaredSet.has(value))
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([value, count]) => ({ value, count }));

	return [...options, ...extras];
}

/**
 * Free-text vocabulary: whatever people actually typed, most common first.
 *
 * Capped, because this list is unbounded by construction — the Full Name facet is one
 * row per person, which on the dev database is 1,852 options and 74 KB shipped to
 * three admin pages that mostly want the other two facets. Truncation is reported
 * rather than hidden; the predicate still accepts any value and the typo-tolerant
 * search box is how a name outside the list gets found.
 */
function comboboxOptions(counts: Map<string, number>): {
	options: LinkedFacetOption[];
	truncated: boolean;
} {
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	return {
		options: sorted.slice(0, MAX_FACET_OPTIONS).map(([value, count]) => ({ value, count })),
		truncated: sorted.length > MAX_FACET_OPTIONS
	};
}

export const filtersRouter = router({
	/**
	 * The filter controls to render for the linked application fields, with counts.
	 *
	 * A field with no question linked to it is **omitted**, not returned empty: nothing
	 * in the form writes that column, so the filter does not exist rather than existing
	 * and matching nobody.
	 *
	 * Counts are global — every `User` row, unscoped by role, decision or anything else
	 * the calling page is currently filtering on. So the number beside an option is "how
	 * many people hold this value", not "how many of the rows you are looking at". Making
	 * them filter-aware would mean recomputing every facet on every keystroke against the
	 * caller's own predicate, and the number an organizer actually wants from a facet is
	 * the former anyway.
	 */
	linkedFacets: adminProcedure.query(async ({ ctx }): Promise<LinkedFacet[]> => {
		const questions = await ctx.prisma.question.findMany({
			where: { linkedField: { in: [...FILTERABLE_LINKED_FIELDS] } },
			select: { title: true, type: true, options: true, linkedField: true },
			// Two questions may name the same column; the first one on the form wins, so
			// the label matches what an applicant was actually asked.
			orderBy: { order: 'asc' }
		});

		const byField = new Map<LinkedUserField, (typeof questions)[number]>();
		for (const question of questions) {
			if (!isLinkedUserField(question.linkedField)) continue;
			if (!byField.has(question.linkedField)) byField.set(question.linkedField, question);
		}

		// Iterated in FILTERABLE_LINKED_FIELDS order rather than question order, so the
		// filter panel's controls don't reshuffle when someone reorders the application
		// form.
		const facets: LinkedFacet[] = [];
		for (const field of FILTERABLE_LINKED_FIELDS) {
			const question = byField.get(field);
			if (!question) continue;

			const control = controlFor(question.type);
			const { counts, noneCount } = await observedValues(ctx.prisma, field);

			// A select's list is bounded by the question, so it is never truncated.
			const { options, truncated } =
				control === 'select'
					? { options: selectOptions(question.options, counts), truncated: false }
					: comboboxOptions(counts);

			facets.push({ field, label: question.title, control, options, noneCount, truncated });
		}

		return facets;
	})
});
