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

/** What the facet builder needs off a question. */
type FacetQuestion = Pick<
	Question,
	'id' | 'title' | 'type' | 'options' | 'optionPreset' | 'linkedField' | 'targetRole'
>;

/**
 * Which control a question's facet renders as — derived from its `type`, never from its
 * name or its id.
 *
 * `null` means the question gets no facet. That is `LONG_TEXT` alone: the answers are
 * paragraphs, so a value list is a transcript and a substring box over an essay is a
 * search engine, not a filter. Every other type is filterable in the way that type
 * actually reads.
 *
 * A preset-backed question is deliberately *not* a `select`, even though it does
 * enumerate its answers. Two reasons, either of which is enough: the university preset
 * is 6,400 entries against a `MAX_FACET_OPTIONS` of 500, and answers to a preset
 * question are not confined to the list — an applicant whose school isn't there types
 * their own. Observed values are therefore the only complete vocabulary, and a combobox
 * is the only control that copes with the length.
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
			// SHORT_TEXT. Free text with no vocabulary anyone would recognise — "how did
			// you hear about us" collects a thousand spellings of "a friend" — so it gets a
			// substring box rather than a list nobody could read.
			return 'search';
	}
}

/**
 * A linked field's control, which is the same decision with one exception.
 *
 * A linked field only ever gets a value list, never a substring box or a numeric range.
 * Two reasons, and the second is the binding one:
 *
 * Its vocabulary is one cheap `groupBy` over a `User` column away and is bounded by the
 * number of distinct universities rather than by the number of essays, so a list is
 * affordable where it isn't for an answer row.
 *
 * And the wire format for a linked field is a plural array of values — `universities`,
 * `years` — which has nowhere to put a bound or a substring. Rendering a range control
 * over one would produce a filter that looks engaged and narrows nothing.
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
	// column name cannot produce. The set of names is closed by `LINKED_FIELD_COLUMN`,
	// so the cast erases a type that can't be spelled rather than a check that matters.
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
function selectOptions(declared: string[], counts: Map<string, number>): FacetOption[] {
	// Declared options keep the editor's order, including any with a count of zero: the
	// form offers them, so the filter should too, and reordering by popularity would
	// make the control read differently from the question it filters.
	const options: FacetOption[] = declared.map((value) => ({
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
 * "No answer" has to be counted against the population the question targets, not
 * against every account: a question aimed at hackers is unanswered by every judge,
 * mentor and admin in the table, and folding those in would put a `noneCount` of 700
 * beside a filter that can only ever surface applicants. An empty `targetRole` means
 * everyone — the same reading `application.getQuestions` uses.
 */
function audienceSize(targetRole: Role[], byRole: Map<Role, number>, total: number): number {
	if (targetRole.length === 0) return total;
	return targetRole.reduce((sum, role) => sum + (byRole.get(role) ?? 0), 0);
}

/**
 * Tells apart two facets a form gives the same title.
 *
 * The seeded form asks "Organization / Company" twice — once of judges, once of
 * mentors — which are different questions writing different answers, and the panel
 * rendered them as two identical controls with no way to tell which was which.
 *
 * The target role is what actually distinguishes them, so it is appended, and *only*
 * when a title is duplicated: a form with one "Organization / Company" keeps reading
 * as "Organization / Company". A question targeting everyone has no role to name, so
 * it keeps the bare title and the roled ones become the qualified pair.
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
	 * Three kinds, one contract — see `$lib/facets`. A linked field whose question was
	 * unlinked, and a question that was deleted, both simply stop appearing: nothing here
	 * hardcodes which filters exist, so the panel is always a picture of the current form.
	 *
	 * Counts are global — every `User` row, unscoped by role, decision or anything else
	 * the calling page is currently filtering on. So the number beside an option is "how
	 * many people hold this value", not "how many of the rows you are looking at". Making
	 * them filter-aware would mean recomputing every facet on every keystroke against the
	 * caller's own predicate, and the number an organizer actually wants from a facet is
	 * the former anyway.
	 *
	 * Four queries regardless of how many questions the form has: the questions, the
	 * per-role headcount, one `groupBy` over every answer that needs a vocabulary, and
	 * the Settings row the state facet is labelled from. The linked facets add one
	 * `groupBy` each, because they read `User` columns rather than answers.
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
		// filter panel's controls don't reshuffle when someone reorders the application
		// form.
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

			// State sits directly under University because it *is* University, read
			// through a dataset — putting it anywhere else would make an organizer hunt
			// for the two halves of one question.
			if (field === 'UNIVERSITY') {
				const state = await stateFacet(ctx.prisma, settings?.homeState ?? null);
				if (state) facets.push(state);
			}
		}

		// --- Everything else on the form ---
		// A linked question is skipped: it already has a facet above, reading the column
		// its answers were copied into, and offering both would be two controls that
		// narrow the same thing by different routes.
		const answerQuestions = questions
			.filter((q) => q.linkedField === null)
			.map((q) => ({ question: q, control: controlFor(q) }))
			.filter((q): q is { question: FacetQuestion; control: FacetControl } => q.control !== null);

		// One `groupBy` for every question that needs a vocabulary. `search` facets are
		// excluded deliberately — not shipping a thousand distinct essay openings is the
		// entire reason short text gets a substring box instead of a list.
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
