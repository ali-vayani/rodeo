import { describe, it, expect } from 'vitest';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
import { NO_VALUE } from '$lib/linkedFields';
import {
	ALL_ROLES,
	ALL_STATUSES,
	DECISION_OPTIONS,
	DECISION_VALUES,
	NO_DECISION,
	allChecked,
	buildRecipientParams,
	linkedParams,
	malformedEmails,
	parseEmailList,
	type LinkedSelection
} from './filters';

const everything = () =>
	[allChecked(ALL_ROLES), allChecked(ALL_STATUSES), allChecked(DECISION_OPTIONS)] as const;

/** The three linked wire keys, so "omitted" can be asserted rather than assumed. */
const LINKED_KEYS = ['names', 'universities', 'years'] as const;

describe('linkedParams — the omitted-vs-empty convention', () => {
	/**
	 * The regression this whole file exists for. `$lib/server/recipients` reads an
	 * absent key as "no filter" and `[]` as "match nobody"; every linked control
	 * starts empty, so sending `[]` for an untouched one would take the Users page to
	 * zero rows and the custom-email count to zero recipients.
	 */
	it('omits a field with nothing selected rather than sending an empty array', () => {
		const params = linkedParams({});
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('omits a field that was selected and then cleared back to []', () => {
		// What `LinkedFieldFilters`'s Clear button leaves behind: the key exists on the
		// selection object with an empty array. It must still not reach the wire.
		const params = linkedParams({ university: [], year: [], name: [] });
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('sends only the fields that have a selection', () => {
		expect(linkedParams({ year: ['Senior'], university: [] })).toEqual({ years: ['Senior'] });
	});

	it('maps each User column to its plural wire key', () => {
		expect(
			linkedParams({ name: ['Ada Lovelace'], university: ['Rice University'], year: ['Senior'] })
		).toEqual({
			names: ['Ada Lovelace'],
			universities: ['Rice University'],
			years: ['Senior']
		});
	});

	it('passes the no-value sentinel through untouched', () => {
		// The sentinel is a selection like any other — splitting it out is the server's job.
		expect(linkedParams({ university: [NO_VALUE] })).toEqual({ universities: [NO_VALUE] });
	});

	it('copies the arrays instead of aliasing the caller state', () => {
		const selection: LinkedSelection = { year: ['Senior'] };
		const params = linkedParams(selection);
		selection.year?.push('Junior');
		expect(params.years).toEqual(['Senior']);
	});

	it('defaults to no filters at all when called with nothing', () => {
		expect(linkedParams()).toEqual({});
	});
});

describe('buildRecipientParams — linked fields', () => {
	it('sends no linked keys when the filters are untouched', () => {
		// The empty-vs-omitted regression, at the level the pages actually call.
		const params = buildRecipientParams(...everything());
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('carries a linked selection onto the wire keys', () => {
		const params = buildRecipientParams(...everything(), '', { year: ['Senior'] });
		expect(params.years).toEqual(['Senior']);
	});

	it('ANDs a linked filter with an engaged checkbox group', () => {
		// Two independent filters in one params object: the server ANDs them, so both
		// have to survive the translation.
		const [, statuses, decisions] = everything();
		const params = buildRecipientParams(
			Object.fromEntries(ALL_ROLES.map((r) => [r, r === Role.HACKER])),
			statuses,
			decisions,
			'',
			{ year: ['Senior'] }
		);
		expect(params.roles).toEqual([Role.HACKER]);
		expect(params.years).toEqual(['Senior']);
	});

	it('leaves the checkbox groups omitted when every box is checked', () => {
		const params = buildRecipientParams(...everything(), '', { university: ['Rice University'] });
		expect(params.roles).toBeUndefined();
		expect(params.statuses).toBeUndefined();
		expect(params.decisions).toBeUndefined();
		expect(params.includeNoDecision).toBeUndefined();
		expect(params.universities).toEqual(['Rice University']);
	});
});

describe('buildRecipientParams — checkbox groups', () => {
	it('omits every key when nothing is filtered', () => {
		expect(buildRecipientParams(...everything())).toEqual({
			search: undefined,
			roles: undefined,
			statuses: undefined,
			decisions: undefined,
			includeNoDecision: undefined
		});
	});

	it('sends a partial role selection', () => {
		const [roles, statuses, decisions] = everything();
		const params = buildRecipientParams({ ...roles, [Role.ADMIN]: false }, statuses, decisions);
		expect(params.roles).toEqual(ALL_ROLES.filter((r) => r !== Role.ADMIN));
	});

	it('sends a partial status selection', () => {
		const [roles, statuses, decisions] = everything();
		const params = buildRecipientParams(
			roles,
			{ ...statuses, [UserStatus.CREATED]: false },
			decisions
		);
		expect(params.statuses).toEqual(ALL_STATUSES.filter((s) => s !== UserStatus.CREATED));
	});

	/**
	 * The engaged-but-empty case, on the group where getting it backwards is worst: a
	 * display reading "0 recipients" must not be a send to everybody.
	 */
	it('sends an empty decision list, not an omitted one, when every box is unchecked', () => {
		const [roles, statuses] = everything();
		const params = buildRecipientParams(
			roles,
			statuses,
			Object.fromEntries(DECISION_OPTIONS.map((d) => [d, false]))
		);
		expect(params.decisions).toEqual([]);
		expect(params.includeNoDecision).toBe(false);
	});

	it('separates the synthetic no-decision option from the real statuses', () => {
		const [roles, statuses, decisions] = everything();
		const params = buildRecipientParams(roles, statuses, { ...decisions, [NO_DECISION]: false });
		expect(params.decisions).toEqual(DECISION_VALUES);
		expect(params.includeNoDecision).toBe(false);
		expect(params.decisions).not.toContain(NO_DECISION as unknown as DecisionStatus);
	});

	it('trims the search term and omits it when blank', () => {
		expect(buildRecipientParams(...everything(), '  Chn  ').search).toBe('Chn');
		expect(buildRecipientParams(...everything(), '   ').search).toBeUndefined();
	});
});

describe('parseEmailList / malformedEmails', () => {
	it('splits on commas, semicolons and newlines, lowercasing and deduplicating', () => {
		expect(parseEmailList('A@x.com, b@x.com; A@X.COM\nc@x.com')).toEqual([
			'a@x.com',
			'b@x.com',
			'c@x.com'
		]);
	});

	it('flags entries that are not shaped like an address', () => {
		expect(malformedEmails(['a@x.com', 'nope', 'b@x'])).toEqual(['nope', 'b@x']);
	});
});
