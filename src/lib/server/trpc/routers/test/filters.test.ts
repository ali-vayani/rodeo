import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { QuestionType } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, organizerUser, hackerUser, mockGroupBy } from '../test-utils';
import { MAX_FACET_OPTIONS } from '$lib/linkedFields';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

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

/** One `groupBy` result row, keyed by the column being grouped. */
function row(field: string, value: string | null, count: number) {
	return { [field]: value, _count: { _all: count } };
}

describe('filters.linkedFacets — which facets exist', () => {
	it('omits a field no question is linked to, rather than returning it empty', async () => {
		// The filter doesn't exist if nothing writes the column — an empty control would
		// invite an organizer to filter on a field the form never asks about.
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('year', 'Senior', 3)]);

		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets.map((f) => f.field)).toEqual(['YEAR']);
	});

	it('returns nothing at all when no question is linked', async () => {
		db.question.findMany.mockResolvedValue([] as never);
		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets).toEqual([]);
	});

	it('orders facets by the linked-field allowlist, not by question order', async () => {
		// So the filter panel doesn't reshuffle when someone reorders the form.
		db.question.findMany.mockResolvedValue([yearQuestion, universityQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([]);

		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets.map((f) => f.field)).toEqual(['UNIVERSITY', 'YEAR']);
	});

	it('keeps the first question when two claim the same field', async () => {
		db.question.findMany.mockResolvedValue([
			yearQuestion,
			{ ...yearQuestion, title: 'Year (duplicate)' }
		] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([]);

		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets).toHaveLength(1);
		expect(facets[0].label).toBe('Year');
	});

	it('labels the facet with the question title, so the filter reads like the form', async () => {
		db.question.findMany.mockResolvedValue([
			{ ...yearQuestion, title: 'What year are you?' }
		] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([]);

		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets[0].label).toBe('What year are you?');
	});
});

describe('filters.linkedFacets — control derived from the question type', () => {
	it.each([
		[QuestionType.DROPDOWN, 'select'],
		[QuestionType.MULTIPLE_CHOICE, 'select'],
		[QuestionType.SHORT_TEXT, 'combobox'],
		[QuestionType.LONG_TEXT, 'combobox'],
		[QuestionType.NUMBER, 'combobox']
	])('renders %s as %s', async (type, control) => {
		db.question.findMany.mockResolvedValue([{ ...yearQuestion, type }] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([]);

		const facets = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facets[0].control).toBe(control);
	});
});

describe('filters.linkedFacets — select options', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
	});

	it('keeps every declared option in the editor order, including unused ones', async () => {
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('year', 'Senior', 4)]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options.map((o) => o.value)).toEqual(yearQuestion.options);
		expect(facet.options.find((o) => o.value === 'Senior')?.count).toBe(4);
		expect(facet.options.find((o) => o.value === 'Alumni')?.count).toBe(0);
	});

	it('unions in values users hold that the question no longer offers', async () => {
		// An option renamed or deleted after people answered. Without this the answers
		// are stranded: they exist in the column but nothing can select them.
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('year', 'Senior', 4),
			row('year', 'Super Senior', 7)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options.at(-1)).toEqual({ value: 'Super Senior', count: 7 });
	});

	it('appends the stragglers after the declared list, most-held first', async () => {
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('year', 'Retired', 1),
			row('year', 'Super Senior', 7)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options.slice(yearQuestion.options.length)).toEqual([
			{ value: 'Super Senior', count: 7 },
			{ value: 'Retired', count: 1 }
		]);
	});
});

describe('filters.linkedFacets — combobox options', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
	});

	it('lists the observed values with counts, most common first', async () => {
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('university', 'Rice University', 12),
			row('university', 'The University of Texas at Austin', 408),
			row('university', 'University of Texas at Austin', 120)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options).toEqual([
			{ value: 'The University of Texas at Austin', count: 408 },
			{ value: 'University of Texas at Austin', count: 120 },
			{ value: 'Rice University', count: 12 }
		]);
	});

	it('keeps near-duplicate spellings as separate values', async () => {
		// They are separate stored values, and collapsing them here would make the
		// counts disagree with the exact predicate the selection produces.
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('university', 'The University of Texas at Austin', 408),
			row('university', 'University of Texas at Austin', 120)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options).toHaveLength(2);
	});
});

describe('filters.linkedFacets — noneCount', () => {
	beforeEach(() => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
	});

	it('counts NULL and empty-string together', async () => {
		// application.save does not trim, so a blank answer is stored as '' — treating
		// it as a value would put an unnamed option in the list and undercount "none".
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('university', null, 500),
			row('university', '', 30),
			row('university', 'Rice University', 12)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.noneCount).toBe(530);
		expect(facet.options).toEqual([{ value: 'Rice University', count: 12 }]);
	});

	it('never lets the empty string into the option list', async () => {
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('university', '', 30)]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options).toEqual([]);
		expect(facet.noneCount).toBe(30);
	});

	it('is zero when everyone has answered', async () => {
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('university', 'Rice University', 12)]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.noneCount).toBe(0);
	});
});

describe('filters.linkedFacets — permissions', () => {
	it('is refused to an organizer, like every other per-person surface', async () => {
		// Aggregate counts of a named applicant pool are still applicant data — at a
		// count of one, literally so. None of the pages that use this are in
		// ORGANIZER_SECTIONS either.
		await expect(createTestCaller(db, organizerUser).filters.linkedFacets()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('is refused to a hacker', async () => {
		await expect(createTestCaller(db, hackerUser).filters.linkedFacets()).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('is refused to an anonymous caller', async () => {
		await expect(createTestCaller(db, null).filters.linkedFacets()).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});

describe('filters.linkedFacets — the combobox option cap', () => {
	/** More distinct values than any control can usefully render. */
	const crowd = Array.from({ length: MAX_FACET_OPTIONS + 3 }, (_, i) =>
		row('university', `University ${i}`, i + 1)
	);

	it('caps a combobox and says that it did', async () => {
		// Unbounded by construction: the Full Name facet is one option per person, which
		// on the dev database is 1,852 values and 74 KB shipped to three admin pages.
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue(crowd);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options).toHaveLength(MAX_FACET_OPTIONS);
		expect(facet.truncated).toBe(true);
	});

	it('keeps the most-held values when it cuts', async () => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue(crowd);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options[0].count).toBe(MAX_FACET_OPTIONS + 3);
		expect(facet.options.map((o) => o.value)).not.toContain('University 0');
	});

	it('does not claim truncation when the vocabulary fits', async () => {
		db.question.findMany.mockResolvedValue([universityQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('university', 'Rice University', 12)]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.truncated).toBe(false);
	});

	it('never truncates a select, whose list the question bounds', async () => {
		db.question.findMany.mockResolvedValue([yearQuestion] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue(
			Array.from({ length: MAX_FACET_OPTIONS + 3 }, (_, i) => row('year', `Year ${i}`, 1))
		);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.truncated).toBe(false);
		expect(facet.options.length).toBeGreaterThan(MAX_FACET_OPTIONS);
	});
});

describe('filters.linkedFacets — a preset-backed question', () => {
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
		mockGroupBy(db.user.groupBy).mockResolvedValue([row('university', 'Rice University', 4)]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.control).toBe('combobox');
	});

	it('lists what applicants actually hold, so write-ins are filterable', async () => {
		// The whole point of the escape hatch: a school that is not in the preset has to
		// be selectable in the filter, or the organizer cannot find the applicant who
		// typed it.
		db.question.findMany.mockResolvedValue([presetUniversity] as never);
		mockGroupBy(db.user.groupBy).mockResolvedValue([
			row('university', 'Rice University', 4),
			row('university', 'Riverbend Institute of Technology', 1)
		]);

		const [facet] = await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(facet.options.map((o) => o.value)).toContain('Riverbend Institute of Technology');
	});

	it('groups by the User column, not by the enum member naming it', async () => {
		// `by: ['UNIVERSITY']` is not a column and Prisma would reject it at runtime.
		db.question.findMany.mockResolvedValue([presetUniversity] as never);
		const groupBy = mockGroupBy(db.user.groupBy).mockResolvedValue([]);

		await createTestCaller(db, adminUser).filters.linkedFacets();
		expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['university'] }));
	});
});
