import type { PrismaClient, Question } from '$lib/generated/prisma/client';
import { QuestionType, Role } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import {
	FILTERABLE_LINKED_FIELDS,
	LINKED_FIELD_COLUMN,
	isLinkedField,
	type LinkedField
} from '$lib/linkedFields';
import {
	MAX_FACET_OPTIONS,
	linkedFacetKey,
	questionFacetKey,
	type Facet,
	type FacetControl,
	type FacetOption
} from '$lib/facets';
import { stateFacet } from '$lib/server/homeState';
import { hasPresetOptions } from '$lib/questions/options';
import { humanizeEnum } from '$lib/format';

/**
 * The filter vocabulary for every application answer worth filtering on.
 *
 * `adminProcedure`, not `portalProcedure`. The pages that render these controls are
 * absent from `ORGANIZER_SECTIONS`, so widening it would grant nothing usable while
 * leaking every university in the applicant pool with exact headcounts. At a count of
 * one that is per-person data in aggregate clothing.
 */

/** What the facet builder needs off a question. */
type FacetQuestion = Pick<
	Question,
	'id' | 'title' | 'type' | 'options' | 'optionPreset' | 'linkedField' | 'targetRole'
>;

/**
 * Which control a question's facet renders as. Derived from its `type`, never from its
 * name or id.
 *
 * `null` means no facet, which is `LONG_TEXT` alone. A value list over paragraphs is a
 * transcript, and a substring box over an essay is a search engine.
 *
 * A preset-backed question is deliberately not a `select`. The university preset is
 * 6,400 entries against a `MAX_FACET_OPTIONS` of 500, and answers are not confined to
 * the list anyway, so observed values are the only complete vocabulary.
 */
function controlFor(question: Pick<Question, 'type' | 'optionPreset'>): FacetControl | null {
	if (question.type === QuestionType.LONG_TEXT) return null;
	if (hasPresetOptions(question)) return 'combobox';
	switch (question.type) {
		case QuestionType.DROPDOWN:
		case QuestionType.MULTIPLE_CHOICE:
		case QuestionType.CHECKBOX:
			return 'select';
		case QuestionType.NUMBER:
			return 'range';
		default:
			// SHORT_TEXT. Free text with no vocabulary anyone would recognise, so it gets a
			// substring box rather than a list nobody could read.
			return 'search';
	}
}

/**
 * A linked field's control. The same decision, except it only ever gets a value list.
 *
 * Its vocabulary is one cheap `groupBy` over a `User` column away, so a list is
 * affordable where it is not for an answer row. And the wire format is a plural array
 * of values (`universities`, `years`) with nowhere to put a bound or a substring.
 */
function linkedControlFor(question: Pick<Question, 'type' | 'optionPreset'>): FacetControl {
	const control = controlFor(question);
	return control === 'select' ? 'select' : 'combobox';
}

/** How many users hold each distinct value of a linked column, plus the absent count. */
async function observedValues(
	prisma: Pick<PrismaClient, 'user'>,
	field: LinkedField
): Promise<{ counts: Map<string, number>; noneCount: number }> {
	// `groupBy`'s return type is derived from the `by` tuple, which a runtime-chosen
	// column name cannot produce. `LINKED_FIELD_COLUMN` is what keeps the set closed.
	const column = LINKED_FIELD_COLUMN[field];
	const rows = (await (prisma.user.groupBy as unknown as (args: unknown) => Promise<unknown[]>)({
		by: [column],
		_count: { _all: true }
	})) as ({ _count: { _all: number } } & Record<string, string | null>)[];

	const counts = new Map<string, number>();
	let noneCount = 0;
	for (const row of rows) {
		const value = row[column];
		const count = row._count._all;
		// `''` is absent everywhere. The write-through in `application.save` does not trim,
		// so a blank answer stores an empty string rather than leaving the column NULL.
		if (value === null || value === '') noneCount += count;
		else counts.set(value, count);
	}

	return { counts, noneCount };
}

/** Declared options first, then values users hold that the question no longer offers. */
function selectOptions(declared: string[], counts: Map<string, number>): FacetOption[] {
	// Declared options keep the editor's order, including zero-count ones. The form
	// offers them, so the filter should too.
	const options: FacetOption[] = declared.map((value) => ({
		value,
		count: counts.get(value) ?? 0
	}));

	// Values nobody can pick any more but plenty still hold, from an option renamed or
	// deleted after they answered. Appended rather than interleaved, most-held first.
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
 * Capped, because this list is unbounded by construction. The Full Name facet is one
 * row per person. Truncation is reported rather than hidden. The predicate still
 * accepts any value, and the typo-tolerant search box finds names outside the list.
 */
function comboboxOptions(counts: Map<string, number>): {
	options: FacetOption[];
	truncated: boolean;
} {
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	return {
		options: sorted.slice(0, MAX_FACET_OPTIONS).map(([value, count]) => ({ value, count })),
		truncated: sorted.length > MAX_FACET_OPTIONS
	};
}

/** A CHECKBOX stores `'true'`/`'false'`, which is not what a filter row should read. */
const CHECKBOX_OPTIONS = [
	{ value: 'true', label: 'Yes' },
	{ value: 'false', label: 'No' }
];

/**
 * How many users a question is even asked of.
 *
 * "No answer" is counted against the population the question targets, not every
 * account. Otherwise a hacker-only question shows a `noneCount` covering every judge
 * and admin. An empty `targetRole` means everyone.
 */
function audienceSize(targetRole: Role[], byRole: Map<Role, number>, total: number): number {
	if (targetRole.length === 0) return total;
	return targetRole.reduce((sum, role) => sum + (byRole.get(role) ?? 0), 0);
}

/**
 * Tells apart two facets a form gives the same title.
 *
 * The seeded form asks "Organization / Company" of judges and of mentors. Different
 * questions, rendered as two identical controls. The target role is appended, and only
 * when a title is duplicated. A question targeting everyone keeps the bare title.
 */
function disambiguate(facets: Facet[], roles: Map<string, Role[]>): void {
	const seen = new Map<string, number>();
	for (const facet of facets) seen.set(facet.label, (seen.get(facet.label) ?? 0) + 1);

	for (const facet of facets) {
		if ((seen.get(facet.label) ?? 0) < 2) continue;
		const targeted = roles.get(facet.key);
		if (!targeted?.length) continue;
		facet.label = `${facet.label} (${targeted.map(humanizeEnum).join(', ')})`;
	}
}

export const filtersRouter = router({
	/**
	 * Every filter control the admin pages should render, with counts.
	 *
	 * Three kinds, one contract. See `$lib/facets`. Nothing here hardcodes which filters
	 * exist, so an unlinked field or a deleted question simply stops appearing.
	 *
	 * Counts are global: every `User` row, unscoped by whatever the calling page is
	 * filtering on. So a number beside an option means "how many people hold this value",
	 * which is what an organizer wants from a facet, and it avoids recomputing every facet
	 * on every keystroke.
	 *
	 * Four queries regardless of form size, plus one `groupBy` per linked facet.
	 */
	facets: adminProcedure.query(async ({ ctx }): Promise<Facet[]> => {
		const [questions, roleRows, totalUsers, settings] = await Promise.all([
			ctx.prisma.question.findMany({
				select: {
					id: true,
					title: true,
					type: true,
					options: true,
					optionPreset: true,
					linkedField: true,
					targetRole: true
				},
				// Two questions may name the same linked column; the first one on the form
				// wins, so the label matches what an applicant was actually asked.
				orderBy: { order: 'asc' }
			}),
			ctx.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
			ctx.prisma.user.count(),
			ctx.prisma.settings.findFirst({ select: { homeState: true } })
		]);

		const byRole = new Map<Role, number>(roleRows.map((r) => [r.role, r._count._all]));

		const facets: Facet[] = [];

		// --- Linked fields, read off their `User` columns ---
		const byField = new Map<LinkedField, FacetQuestion>();
		for (const question of questions) {
			if (!isLinkedField(question.linkedField)) continue;
			if (!byField.has(question.linkedField)) byField.set(question.linkedField, question);
		}

		// Iterated in FILTERABLE_LINKED_FIELDS order rather than question order, so the
		// panel's controls do not reshuffle when someone reorders the application form.
		for (const field of FILTERABLE_LINKED_FIELDS) {
			const question = byField.get(field);
			if (!question) continue;

			const control = linkedControlFor(question);
			const { counts, noneCount } = await observedValues(ctx.prisma, field);

			// A select's list is bounded by the question, so it is never truncated.
			const { options, truncated } =
				control === 'select'
					? { options: selectOptions(question.options, counts), truncated: false }
					: comboboxOptions(counts);

			facets.push({
				key: linkedFacetKey(field),
				label: question.title,
				control,
				options,
				noneCount,
				truncated
			});

			// State sits directly under University because it is University read through a
			// dataset. Anywhere else and an organizer hunts for the two halves of one question.
			if (field === 'UNIVERSITY') {
				const state = await stateFacet(ctx.prisma, settings?.homeState ?? null);
				if (state) facets.push(state);
			}
		}

		// --- Everything else on the form ---
		// A linked question is skipped. It already has a facet above reading the column its
		// answers were copied into, and both would narrow the same thing by different routes.
		const answerQuestions = questions
			.filter((q) => q.linkedField === null)
			.map((q) => ({ question: q, control: controlFor(q) }))
			.filter((q): q is { question: FacetQuestion; control: FacetControl } => q.control !== null);

		// One `groupBy` per question that needs a vocabulary. `search` facets are excluded.
		// Not shipping a thousand essay openings is why short text gets a substring box.
		const tallied = answerQuestions.filter((q) => q.control !== 'search');
		const valueRows = tallied.length
			? await ctx.prisma.applicationResponse.groupBy({
					by: ['questionId', 'value'],
					where: { questionId: { in: tallied.map((q) => q.question.id) } },
					_count: { _all: true }
				})
			: [];

		/** Target roles per facet key, for `disambiguate` below. */
		const questionRoles = new Map<string, Role[]>();

		const answerCounts = new Map<string, Map<string, number>>();
		const answered = new Map<string, number>();
		for (const row of valueRows) {
			// Same NULL-or-empty reading as the linked columns: a field opened and cleared
			// leaves a row holding '', and that is an absent answer, not a value.
			if (row.value === '') continue;
			const counts = answerCounts.get(row.questionId) ?? new Map<string, number>();
			counts.set(row.value, row._count._all);
			answerCounts.set(row.questionId, counts);
			answered.set(row.questionId, (answered.get(row.questionId) ?? 0) + row._count._all);
		}

		for (const { question, control } of answerQuestions) {
			const counts = answerCounts.get(question.id) ?? new Map<string, number>();
			const audience = audienceSize(question.targetRole, byRole, totalUsers);
			// Never negative, even if the audience shrank under answers already given —
			// a role changed after someone applied leaves their answer behind.
			const noneCount = Math.max(0, audience - (answered.get(question.id) ?? 0));

			const facet: Facet = {
				key: questionFacetKey(question.id),
				label: question.title,
				control,
				options: [],
				noneCount
			};

			if (control === 'select') {
				facet.options =
					question.type === QuestionType.CHECKBOX
						? CHECKBOX_OPTIONS.map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }))
						: selectOptions(question.options, counts);
			} else if (control === 'combobox') {
				const { options, truncated } = comboboxOptions(counts);
				facet.options = options;
				facet.truncated = truncated;
			} else if (control === 'range') {
				// The observed extent, so the two inputs can say what the data actually
				// spans rather than making an organizer guess at the units.
				const numbers = [...counts.keys()].map(Number).filter(Number.isFinite);
				if (numbers.length) {
					facet.bounds = { min: Math.min(...numbers), max: Math.max(...numbers) };
				}
			}

			facets.push(facet);
			questionRoles.set(facet.key, question.targetRole);
		}

		// Last, so it sees the linked and state facets too — a question titled "State"
		// would collide with the derived one just as readily as with another question.
		disambiguate(facets, questionRoles);

		return facets;
	})
});
