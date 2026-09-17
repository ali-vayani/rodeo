import type { PrismaClient, Question } from '$lib/generated/prisma/client';
import { QuestionType, Role } from '$lib/generated/prisma/client';
import { router, adminProcedure } from '../init';
import {
	FILTERABLE_LINKED_FIELDS,
	USER_LINKED_FIELD_COLUMN,
	isUserLinkedField,
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
import { decodeMultiSelect } from '$lib/questions/multiSelect';
import { humanizeEnum } from '$lib/format';

/**
 * The filter vocabulary for every application answer worth filtering on.
 *
 * `adminProcedure`, not `portalProcedure`: the pages rendering these controls are not
 * in `ORGANIZER_SECTIONS`, and every university with exact headcounts is per-person
 * data in aggregate clothing.
 */

/** What the facet builder needs off a question. */
type FacetQuestion = Pick<
	Question,
	'id' | 'title' | 'type' | 'options' | 'optionPreset' | 'linkedField' | 'targetRole'
>;

/**
 * Which control a question's facet renders as, derived from its `type`. `null` means
 * no facet: LONG_TEXT only, since a value list over essays is a transcript.
 *
 * Preset-backed questions are a `combobox`, not a `select`: the university preset is
 * 6,400 entries against `MAX_FACET_OPTIONS` of 500, and answers aren't confined to it.
 */
function controlFor(question: Pick<Question, 'type' | 'optionPreset'>): FacetControl | null {
	if (question.type === QuestionType.LONG_TEXT) return null;
	if (hasPresetOptions(question)) return 'combobox';
	switch (question.type) {
		case QuestionType.DROPDOWN:
		case QuestionType.MULTIPLE_CHOICE:
		case QuestionType.MULTI_SELECT:
		case QuestionType.CHECKBOX:
			return 'select';
		case QuestionType.NUMBER:
			return 'range';
		default:
			// SHORT_TEXT: free text with no shared vocabulary gets a substring box.
			return 'search';
	}
}

/**
 * A linked field always gets a value list: its vocabulary is one cheap `groupBy` over a
 * `User` column, and the wire format (`universities`, `years`) has nowhere to put a
 * bound or a substring.
 */
function linkedControlFor(question: Pick<Question, 'type' | 'optionPreset'>): FacetControl {
	const control = controlFor(question);
	return control === 'select' ? 'select' : 'combobox';
}

/**
 * How many users hold each distinct value of a linked column, plus the absent count.
 *
 * Scalar linked fields only: `groupBy` here counts one row per distinct column value,
 * which is meaningless for DIETARY_RESTRICTION's array column (it would group by
 * exact array equality, not by individual restriction) — that one is filtered like
 * any other question instead. See `FILTERABLE_LINKED_FIELDS`.
 */
async function observedValues(
	prisma: Pick<PrismaClient, 'user'>,
	field: Exclude<LinkedField, 'DIETARY_RESTRICTION'>
): Promise<{ counts: Map<string, number>; noneCount: number }> {
	// `groupBy`'s return type is keyed on the `by` tuple, which a runtime-chosen column
	// can't produce. `LINKED_FIELD_COLUMN` keeps the set closed.
	const column = USER_LINKED_FIELD_COLUMN[field];
	const rows = (await (prisma.user.groupBy as unknown as (args: unknown) => Promise<unknown[]>)({
		by: [column],
		_count: { _all: true }
	})) as ({ _count: { _all: number } } & Record<string, string | null>)[];

	const counts = new Map<string, number>();
	let noneCount = 0;
	for (const row of rows) {
		const value = row[column];
		const count = row._count._all;
		// `application.save` doesn't trim, so a blank answer stores '' rather than NULL.
		if (value === null || value === '') noneCount += count;
		else counts.set(value, count);
	}

	return { counts, noneCount };
}

/**
 * Declared options in the editor's order (zero counts included, since the form offers
 * them), then values users still hold from options since renamed or deleted.
 */
function selectOptions(declared: string[], counts: Map<string, number>): FacetOption[] {
	const options: FacetOption[] = declared.map((value) => ({
		value,
		count: counts.get(value) ?? 0
	}));

	const declaredSet = new Set(declared);
	const extras = [...counts.entries()]
		.filter(([value]) => !declaredSet.has(value))
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([value, count]) => ({ value, count }));

	return [...options, ...extras];
}

/**
 * Free-text vocabulary, most common first. Capped because the list is unbounded (Full
 * Name is one row per person); truncation is reported, and the predicate still accepts
 * values outside the list.
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
 * How many users a question is asked of, so "no answer" on a hacker-only question
 * doesn't count every judge and admin. Empty `targetRole` means everyone.
 */
function audienceSize(targetRole: Role[], byRole: Map<Role, number>, total: number): number {
	if (targetRole.length === 0) return total;
	return targetRole.reduce((sum, role) => sum + (byRole.get(role) ?? 0), 0);
}

/**
 * Appends the target role to facets sharing a title (the seeded form asks
 * "Organization / Company" of judges and of mentors). Only duplicated titles change,
 * and a question targeting everyone keeps the bare title.
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
	 * Every filter control the admin pages render, with counts. See `$lib/facets`.
	 * Nothing hardcodes which filters exist, so a deleted question just stops appearing.
	 *
	 * Counts are global, unscoped by the calling page's filters: "how many people hold
	 * this value", and no recompute on every keystroke. Four queries regardless of form
	 * size, plus one `groupBy` per linked facet.
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
				// Two questions may link the same column; the first on the form wins.
				orderBy: { order: 'asc' }
			}),
			ctx.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
			ctx.prisma.user.count(),
			ctx.prisma.settings.findFirst({ select: { homeState: true } })
		]);

		const byRole = new Map<Role, number>(roleRows.map((r) => [r.role, r._count._all]));

		const facets: Facet[] = [];

		const byField = new Map<LinkedField, FacetQuestion>();
		for (const question of questions) {
			if (!isUserLinkedField(question.linkedField)) continue;
			if (!byField.has(question.linkedField)) byField.set(question.linkedField, question);
		}

		// Linked fields, read off their `User` columns. Iterated in FILTERABLE_LINKED_FIELDS
		// order so the panel doesn't reshuffle when the form is reordered.
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

			// State is University read through a dataset, so it sits directly under it.
			if (field === 'UNIVERSITY') {
				const state = await stateFacet(ctx.prisma, settings?.homeState ?? null);
				if (state) facets.push(state);
			}
		}

		// Everything else on the form. Linked questions are skipped: they already have a
		// facet above reading the column their answers were copied into.
		const answerQuestions = questions
			.filter((q) => !isUserLinkedField(q.linkedField))
			.map((q) => ({ question: q, control: controlFor(q) }))
			.filter((q): q is { question: FacetQuestion; control: FacetControl } => q.control !== null);

		// `search` facets need no vocabulary; shipping a thousand short-text answers is
		// why they get a substring box.
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

		// `groupBy` buckets a MULTI_SELECT by its whole encoded set, and nobody filters by
		// "picked exactly Rust and Go". Those rows are unpacked onto their options below.
		const multiSelectIds = new Set(
			tallied
				.filter(({ question }) => question.type === QuestionType.MULTI_SELECT)
				.map(({ question }) => question.id)
		);

		const answerCounts = new Map<string, Map<string, number>>();
		const answered = new Map<string, number>();
		for (const row of valueRows) {
			// As with the linked columns, '' is an absent answer, not a value.
			if (row.value === '') continue;
			const counts = answerCounts.get(row.questionId) ?? new Map<string, number>();
			if (multiSelectIds.has(row.questionId)) {
				// Accumulated, not assigned: two different sets can both contain this option.
				for (const option of decodeMultiSelect(row.value)) {
					counts.set(option, (counts.get(option) ?? 0) + row._count._all);
				}
			} else {
				counts.set(row.value, row._count._all);
			}
			answerCounts.set(row.questionId, counts);
			// Still one row per user either way, so the answered tally is unaffected by the
			// unpacking above — the option counts sum past it, and are meant to.
			answered.set(row.questionId, (answered.get(row.questionId) ?? 0) + row._count._all);
		}

		for (const { question, control } of answerQuestions) {
			const counts = answerCounts.get(question.id) ?? new Map<string, number>();
			const audience = audienceSize(question.targetRole, byRole, totalUsers);
			// Never negative: a role changed after applying leaves the answer behind.
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
				// Observed extent, so the inputs can show what the data spans.
				const numbers = [...counts.keys()].map(Number).filter(Number.isFinite);
				if (numbers.length) {
					facet.bounds = { min: Math.min(...numbers), max: Math.max(...numbers) };
				}
			}

			facets.push(facet);
			questionRoles.set(facet.key, question.targetRole);
		}

		// Last, so a question titled "State" collides with the derived facet too.
		disambiguate(facets, questionRoles);

		return facets;
	})
});
