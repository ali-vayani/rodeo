import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { QuestionType, Role } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, organizerUser, hackerUser, mockGroupBy } from '../test-utils';
import { MAX_FACET_OPTIONS, parseFacetKey } from '$lib/facets';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => {
	mockReset(db);
	// The facet query reads more than the one column each test exercises. An unmocked
	// `mockDeep` method resolves to `undefined`, which the builder cannot iterate.
	db.user.count.mockResolvedValue(0);
	db.settings.findFirst.mockResolvedValue(null);
	mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([]);
	mockUserGroups([]);
});

/** One `groupBy` result row, keyed by the column being grouped. */
type GroupRow = { _count: { _all: number } } & Record<string, unknown>;

/**
 * Every `user.groupBy` the facet builder makes, from one list of rows.
 *
 * It groups by `role` for the audience counts and by a linked column per facet, so a
 * single `mockResolvedValue` would hand the role query a list of universities.
 */
function mockUserGroups(rows: GroupRow[]) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the `by` tuple is unspellable here.
	mockGroupBy(db.user.groupBy).mockImplementation(async (args: any) =>
		rows.filter((r) => String(args.by[0]) in r)
	);
}

/** The linked field or question a facet came from, for asserting on which exist. */
function fieldOf(key: string): string | undefined {
	const parsed = parseFacetKey(key);
	return parsed?.kind === 'linked' ? parsed.field : parsed?.kind;
}

const yearQuestion = {
	title: 'Year',
	type: QuestionType.DROPDOWN,
	options: ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Alumni'],
	linkedField: 'YEAR',
	optionPreset: null
};

const universityQuestion = {
	title: 'University',
	type: QuestionType.SHORT_TEXT,
	options: [],
	linkedField: 'UNIVERSITY',
	optionPreset: null
};

function row(field: string, value: string | null, count: number): GroupRow {
	return { [field]: value, _count: { _all: count } };
}

describe('filters.facets — which facets exist', () => {
	it('omits a field no question is linked to, rather than returning it empty', async () => {
		// The filter doesn't exist if nothing writes the column — an empty control would
		// invite an organizer to filter on a field the form never asks about.
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
		mockUserGroups([row('year', 'Senior', 3)]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => fieldOf(f.key))).toEqual(['YEAR']);
	});

	it('returns nothing at all when no question is linked', async () => {
		db.question.findMany.mockResolvedValue([] as never);
		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets).toEqual([]);
	});

	it('orders facets by the linked-field allowlist, not by question order', async () => {
		// So the filter panel doesn't reshuffle when someone reorders the form.
		db.question.findMany.mockResolvedValue([yearQuestion, universityQuestion] as never);
		mockUserGroups([]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => fieldOf(f.key))).toEqual(['UNIVERSITY', 'YEAR']);
	});

	it('keeps the first question when two claim the same field', async () => {
		db.question.findMany.mockResolvedValue([
			yearQuestion,
			{ ...yearQuestion, title: 'Year (duplicate)' }
		] as never);
		mockUserGroups([]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets).toHaveLength(1);
		expect(facets[0].label).toBe('Year');
	});

	it('labels the facet with the question title, so the filter reads like the form', async () => {
		db.question.findMany.mockResolvedValue([
			{ ...yearQuestion, title: 'What year are you?' }
		] as never);
		mockUserGroups([]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets[0].label).toBe('What year are you?');
	});
});

describe('filters.facets — control derived from the question type', () => {
	it.each([
		[QuestionType.DROPDOWN, 'select'],
		[QuestionType.MULTIPLE_CHOICE, 'select'],
		[QuestionType.SHORT_TEXT, 'combobox'],
		[QuestionType.LONG_TEXT, 'combobox'],
		[QuestionType.NUMBER, 'combobox']
	])('renders %s as %s', async (type, control) => {
		db.question.findMany.mockResolvedValue([{ ...yearQuestion, type }] as never);
		mockUserGroups([]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets[0].control).toBe(control);
	});
});

describe('filters.facets — select options', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
	});

	it('keeps every declared option in the editor order, including unused ones', async () => {
		mockUserGroups([row('year', 'Senior', 4)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options.map((o) => o.value)).toEqual(yearQuestion.options);
		expect(facet.options.find((o) => o.value === 'Senior')?.count).toBe(4);
		expect(facet.options.find((o) => o.value === 'Alumni')?.count).toBe(0);
	});

	it('unions in values users hold that the question no longer offers', async () => {
		// An option renamed or deleted after people answered. Without this the answers
		// are stranded: they exist in the column but nothing can select them.
		mockUserGroups([row('year', 'Senior', 4), row('year', 'Super Senior', 7)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options.at(-1)).toEqual({ value: 'Super Senior', count: 7 });
	});

	it('appends the stragglers after the declared list, most-held first', async () => {
		mockUserGroups([row('year', 'Retired', 1), row('year', 'Super Senior', 7)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options.slice(yearQuestion.options.length)).toEqual([
			{ value: 'Super Senior', count: 7 },
			{ value: 'Retired', count: 1 }
		]);
	});
});

describe('filters.facets — combobox options', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
	});

	it('lists the observed values with counts, most common first', async () => {
		mockUserGroups([
			row('university', 'Rice University', 12),
			row('university', 'The University of Texas at Austin', 408),
			row('university', 'University of Texas at Austin', 120)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toEqual([
			{ value: 'The University of Texas at Austin', count: 408 },
			{ value: 'University of Texas at Austin', count: 120 },
			{ value: 'Rice University', count: 12 }
		]);
	});

	it('keeps near-duplicate spellings as separate values', async () => {
		// They are separate stored values, and collapsing them here would make the
		// counts disagree with the exact predicate the selection produces.
		mockUserGroups([
			row('university', 'The University of Texas at Austin', 408),
			row('university', 'University of Texas at Austin', 120)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toHaveLength(2);
	});
});

describe('filters.facets — noneCount', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
	});

	it('counts NULL and empty-string together', async () => {
		// application.save does not trim, so a blank answer is stored as '' — treating
		// it as a value would put an unnamed option in the list and undercount "none".
		mockUserGroups([
			row('university', null, 500),
			row('university', '', 30),
			row('university', 'Rice University', 12)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(530);
		expect(facet.options).toEqual([{ value: 'Rice University', count: 12 }]);
	});

	it('never lets the empty string into the option list', async () => {
		mockUserGroups([row('university', '', 30)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toEqual([]);
		expect(facet.noneCount).toBe(30);
	});

	it('is zero when everyone has answered', async () => {
		mockUserGroups([row('university', 'Rice University', 12)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(0);
	});
});

describe('filters.facets — questions that write no User column', () => {
	const dropdown = {
		id: 'q-diet',
		title: 'Dietary restrictions',
		type: QuestionType.DROPDOWN,
		options: ['None', 'Vegetarian', 'Vegan'],
		optionPreset: null,
		linkedField: null,
		targetRole: []
	};

	function answerRow(questionId: string, value: string, count: number) {
		return { questionId, value, _count: { _all: count } };
	}

	it('offers a facet for every question, not only the linked ones', async () => {
		db.question.findMany.mockResolvedValue([dropdown] as never);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', 'Vegan', 12)
		]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.label)).toEqual(['Dietary restrictions']);
		expect(facets[0].options).toEqual([
			{ value: 'None', count: 0 },
			{ value: 'Vegetarian', count: 0 },
			{ value: 'Vegan', count: 12 }
		]);
	});

	it.each([
		[QuestionType.DROPDOWN, 'select'],
		[QuestionType.MULTIPLE_CHOICE, 'select'],
		[QuestionType.CHECKBOX, 'select'],
		[QuestionType.MULTI_SELECT, 'select'],
		[QuestionType.NUMBER, 'range'],
		[QuestionType.SHORT_TEXT, 'search']
	])('renders %s as %s', async (type, control) => {
		db.question.findMany.mockResolvedValue([{ ...dropdown, type }] as never);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.control).toBe(control);
	});

	it('gives a long-text question no facet at all', async () => {
		// The answers are paragraphs: a value list is a transcript, and a substring box
		// over an essay is a search engine rather than a filter.
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.LONG_TEXT }
		] as never);

		expect(await createTestCaller(db, adminUser).filters.facets()).toEqual([]);
	});

	it('ships no option list for a substring box', async () => {
		// Not shipping a thousand distinct essay openings is the entire reason short
		// text gets a substring box instead of a list.
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.SHORT_TEXT }
		] as never);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toEqual([]);
		expect(mockGroupBy(db.applicationResponse.groupBy)).not.toHaveBeenCalled();
	});

	it('labels a checkbox Yes/No rather than true/false', async () => {
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.CHECKBOX, options: [] }
		] as never);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', 'true', 5),
			answerRow('q-diet', 'false', 7)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toEqual([
			{ value: 'true', label: 'Yes', count: 5 },
			{ value: 'false', label: 'No', count: 7 }
		]);
	});

	it('counts a multi-select answer against every option it holds', async () => {
		// `groupBy` buckets these rows by the whole encoded set, so left alone the facet
		// would offer '["None","Vegan"]' as a filter value and report every real option
		// as held by nobody.
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.MULTI_SELECT }
		] as never);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', '["Vegetarian","Vegan"]', 4),
			answerRow('q-diet', '["Vegan"]', 3)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toEqual([
			{ value: 'None', count: 0 },
			{ value: 'Vegetarian', count: 4 },
			// Both sets contain it, so the counts add rather than overwrite each other.
			{ value: 'Vegan', count: 7 }
		]);
	});

	it('counts a multi-select respondent once toward the answered tally', async () => {
		// The option counts deliberately sum past the number of people. `noneCount` must
		// not, or picking three boxes would drive "no answer" negative.
		db.user.count.mockResolvedValue(10);
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.MULTI_SELECT }
		] as never);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', '["None","Vegetarian","Vegan"]', 6)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(4);
	});

	it('captions a numeric range with the extent of the answers', async () => {
		db.question.findMany.mockResolvedValue([
			{ ...dropdown, type: QuestionType.NUMBER, options: [] }
		] as never);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', '3', 5),
			answerRow('q-diet', '14', 1),
			answerRow('q-diet', '0', 9)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.bounds).toEqual({ min: 0, max: 14 });
	});

	it('skips a question that already has a linked facet', async () => {
		// Two controls narrowing the same thing by different routes is one too many.
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
		mockUserGroups([row('year', 'Senior', 3)]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets).toHaveLength(1);
		expect(facets[0].key).toBe('linked:YEAR');
	});

	it('counts "no answer" against the roles the question targets', async () => {
		// A question aimed at hackers is unanswered by every judge and admin in the table.
		// Folding those in would put a noneCount of 700 beside an applicant-only filter.
		db.question.findMany.mockResolvedValue([{ ...dropdown, targetRole: [Role.HACKER] }] as never);
		db.user.count.mockResolvedValue(900);
		mockUserGroups([
			{ role: Role.HACKER, _count: { _all: 100 } },
			{ role: Role.ADMIN, _count: { _all: 800 } }
		]);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', 'Vegan', 40)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(60);
	});

	it('counts "no answer" against everyone when the question targets no role', async () => {
		db.question.findMany.mockResolvedValue([dropdown] as never);
		db.user.count.mockResolvedValue(900);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', 'Vegan', 40)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(860);
	});

	it('reads a blank answer as unanswered rather than as a value', async () => {
		db.question.findMany.mockResolvedValue([dropdown] as never);
		db.user.count.mockResolvedValue(10);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', '', 3),
			answerRow('q-diet', 'Vegan', 4)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options.map((o) => o.value)).not.toContain('');
		expect(facet.noneCount).toBe(6);
	});

	it('never reports a negative noneCount', async () => {
		// A role changed after someone applied leaves their answer behind, so answers can
		// outnumber the audience.
		db.question.findMany.mockResolvedValue([{ ...dropdown, targetRole: [Role.HACKER] }] as never);
		mockUserGroups([{ role: Role.HACKER, _count: { _all: 1 } }]);
		mockGroupBy(db.applicationResponse.groupBy).mockResolvedValue([
			answerRow('q-diet', 'Vegan', 40)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.noneCount).toBe(0);
	});
});

describe('filters.facets — two questions with the same title', () => {
	const org = {
		id: 'q-org-judge',
		title: 'Organization / Company',
		type: QuestionType.SHORT_TEXT,
		options: [],
		optionPreset: null,
		linkedField: null,
		targetRole: [Role.JUDGE]
	};

	it('names the target role on each, so the two controls are tellable apart', async () => {
		// The seeded form asks this twice — once of judges, once of mentors. Rendered
		// bare, they are two identical controls narrowing different answers.
		db.question.findMany.mockResolvedValue([
			org,
			{ ...org, id: 'q-org-mentor', targetRole: [Role.MENTOR] }
		] as never);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.label)).toEqual([
			'Organization / Company (Judge)',
			'Organization / Company (Mentor)'
		]);
	});

	it('leaves a unique title alone', async () => {
		db.question.findMany.mockResolvedValue([org] as never);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.label).toBe('Organization / Company');
	});

	it('leaves the one that targets everybody bare, having no role to name', async () => {
		db.question.findMany.mockResolvedValue([
			{ ...org, targetRole: [] },
			{ ...org, id: 'q-org-mentor', targetRole: [Role.MENTOR] }
		] as never);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.label)).toEqual([
			'Organization / Company',
			'Organization / Company (Mentor)'
		]);
	});
});

describe('filters.facets — the state facet', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockUserGroups([row('university', 'Rice University', 4)]);
		db.settings.findFirst.mockResolvedValue({ homeState: 'TX' } as never);
	});

	it('sits directly under University, which is where it comes from', async () => {
		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.key)).toEqual(['linked:UNIVERSITY', 'state']);
	});

	it('names the home state from Settings', async () => {
		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets[1].options[0]).toEqual({ value: 'TX', label: 'Texas', count: 4 });
	});

	it('is omitted when no home state is configured', async () => {
		// The facet is the home/outside pair and nothing else, so with no home there is
		// nothing to offer — not a fallback list of every state anyone attends.
		db.settings.findFirst.mockResolvedValue(null);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.key)).toEqual(['linked:UNIVERSITY']);
	});

	it("is omitted when no applicant's university places anywhere", async () => {
		mockUserGroups([row('university', null, 12)]);

		const facets = await createTestCaller(db, adminUser).filters.facets();
		expect(facets.map((f) => f.key)).toEqual(['linked:UNIVERSITY']);
	});
});

describe('filters.facets — permissions', () => {
	it('is allowed to an organizer, who filters the admissions review queue with it', async () => {
		db.question.findMany.mockResolvedValue([]);
		await expect(createTestCaller(db, organizerUser).filters.facets()).resolves.toBeDefined();
	});

	it('is refused to a hacker', async () => {
		await expect(createTestCaller(db, hackerUser).filters.facets()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('is refused to an anonymous caller', async () => {
		await expect(createTestCaller(db, null).filters.facets()).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});

describe('filters.facets — the combobox option cap', () => {
	/** More distinct values than any control can usefully render. */
	const crowd = Array.from({ length: MAX_FACET_OPTIONS + 3 }, (_, i) =>
		row('university', `University ${i}`, i + 1)
	);

	it('caps a combobox and says that it did', async () => {
		// Unbounded by construction: the Full Name facet is one option per person, which
		// on the dev database is 1,852 values and 74 KB shipped to three admin pages.
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockUserGroups(crowd);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options).toHaveLength(MAX_FACET_OPTIONS);
		expect(facet.truncated).toBe(true);
	});

	it('keeps the most-held values when it cuts', async () => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockUserGroups(crowd);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options[0].count).toBe(MAX_FACET_OPTIONS + 3);
		expect(facet.options.map((o) => o.value)).not.toContain('University 0');
	});

	it('does not claim truncation when the vocabulary fits', async () => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockUserGroups([row('university', 'Rice University', 12)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.truncated).toBe(false);
	});

	it('never truncates a select, whose list the question bounds', async () => {
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
		mockUserGroups(
			Array.from({ length: MAX_FACET_OPTIONS + 3 }, (_, i) => row('year', `Year ${i}`, 1))
		);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.truncated).toBe(false);
		expect(facet.options.length).toBeGreaterThan(MAX_FACET_OPTIONS);
	});
});

describe('filters.facets — a preset-backed question', () => {
	const presetUniversity = {
		title: 'University',
		type: QuestionType.DROPDOWN,
		options: [],
		optionPreset: 'UNIVERSITIES_NA',
		linkedField: 'UNIVERSITY'
	};

	it('renders as a combobox, not a select, despite enumerating its answers', async () => {
		// Two independent reasons, either sufficient. The preset is 6,447 entries against
		// a MAX_FACET_OPTIONS of 500 — a select is never truncated, so it would ship the
		// lot. And answers to a preset question are not confined to the list, so the
		// declared options are not the vocabulary in the first place.
		db.question.findMany.mockResolvedValue([presetUniversity] as never);
		mockUserGroups([row('university', 'Rice University', 4)]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.control).toBe('combobox');
	});

	it('lists what applicants actually hold, so write-ins are filterable', async () => {
		// The whole point of the escape hatch: a school that is not in the preset has to
		// be selectable in the filter, or the organizer cannot find the applicant who
		// typed it.
		db.question.findMany.mockResolvedValue([presetUniversity] as never);
		mockUserGroups([
			row('university', 'Rice University', 4),
			row('university', 'Riverbend Institute of Technology', 1)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.facets();
		expect(facet.options.map((o) => o.value)).toContain('Riverbend Institute of Technology');
	});

	it('groups by the User column, not by the enum member naming it', async () => {
		// `by: ['UNIVERSITY']` is not a column and Prisma would reject it at runtime.
		db.question.findMany.mockResolvedValue([presetUniversity] as never);
		mockUserGroups([]);

		await createTestCaller(db, adminUser).filters.facets();
		expect(mockGroupBy(db.user.groupBy)).toHaveBeenCalledWith(
			expect.objectContaining({ by: ['university'] })
		);
	});
});
