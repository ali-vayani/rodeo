import { describe, it, expect } from 'vitest';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
import {
	NO_VALUE,
	OUT_OF_STATE,
	STATE_FACET_KEY,
	linkedFacetKey,
	questionFacetKey,
	type FacetState
} from '$lib/facets';
import {
	ALL_ROLES,
	ALL_STATUSES,
	DECIDABLE_VALUES,
	DECISION_OPTIONS,
	NO_DECISION,
	allChecked,
	buildRecipientParams,
	facetParams,
	parseEmailCsv,
	parseEmailList
} from './filters';
import { malformedEmails } from '$lib/email/address';

const NAME = linkedFacetKey('NAME');
const UNIVERSITY = linkedFacetKey('UNIVERSITY');
const YEAR = linkedFacetKey('YEAR');

const everything = () =>
	[
		allChecked(ALL_ROLES),
		allChecked(ALL_STATUSES),
		allChecked(DECISION_OPTIONS),
		allChecked(DECISION_OPTIONS)
	] as const;

/** Every box in the group unticked. The panels' `clear` resets to all ticked instead,
 * but the state is still reachable by unticking boxes one at a time. */
const cleared = (options: readonly string[]) => Object.fromEntries(options.map((o) => [o, false]));

/** The three linked wire keys, so "omitted" can be asserted rather than assumed. */
const LINKED_KEYS = ['names', 'universities', 'years'] as const;

describe('facetParams — the omitted-vs-empty convention', () => {
	/**
	 * The regression this whole file exists for. `$lib/server/recipients` reads an absent
	 * key as "no filter" and `[]` as "match nobody", and every facet control starts empty,
	 * so sending `[]` for an untouched one would take the Users page to zero rows.
	 */
	it('omits a facet with nothing selected rather than sending an empty array', () => {
		const params = facetParams({});
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('omits a facet that was selected and then cleared back to []', () => {
		// What `FacetFilters`'s Clear button leaves behind: the key exists on the
		// selection object with an empty array. It must still not reach the wire.
		const params = facetParams({
			[UNIVERSITY]: { values: [] },
			[YEAR]: { values: [] },
			[NAME]: { values: [] }
		});
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
		expect(params).not.toHaveProperty('answers');
		expect(params).not.toHaveProperty('states');
	});

	it('sends only the facets that have a selection', () => {
		expect(facetParams({ [YEAR]: { values: ['Senior'] }, [UNIVERSITY]: { values: [] } })).toEqual({
			years: ['Senior']
		});
	});

	it('maps each linked field to its plural wire key', () => {
		expect(
			facetParams({
				[NAME]: { values: ['Ada Lovelace'] },
				[UNIVERSITY]: { values: ['Rice University'] },
				[YEAR]: { values: ['Senior'] }
			})
		).toEqual({
			names: ['Ada Lovelace'],
			universities: ['Rice University'],
			years: ['Senior']
		});
	});

	it('passes the no-value sentinel through untouched', () => {
		// The sentinel is a selection like any other — splitting it out is the server's job.
		expect(facetParams({ [UNIVERSITY]: { values: [NO_VALUE] } })).toEqual({
			universities: [NO_VALUE]
		});
	});

	it('copies the arrays instead of aliasing the caller state', () => {
		const selection: FacetState = { [YEAR]: { values: ['Senior'] } };
		const params = facetParams(selection);
		selection[YEAR].values?.push('Junior');
		expect(params.years).toEqual(['Senior']);
	});

	it('defaults to no filters at all when called with nothing', () => {
		expect(facetParams()).toEqual({});
	});

	it('drops a facet whose key no longer parses', () => {
		// A filter for a question that has since been deleted. Not narrowing by
		// something that no longer exists beats emptying the table over it.
		expect(facetParams({ 'not-a-facet-key': { values: ['x'] } })).toEqual({});
	});
});

describe('facetParams — questions and the state facet', () => {
	const REFERRAL = questionFacetKey('q-referral');
	const HACKATHONS = questionFacetKey('q-hackathons');

	it('sends a question value selection as one answers entry', () => {
		expect(facetParams({ [REFERRAL]: { values: ['A friend'] } })).toEqual({
			answers: [{ questionId: 'q-referral', values: ['A friend'] }]
		});
	});

	it('sends a substring box as contains, trimmed', () => {
		expect(facetParams({ [REFERRAL]: { contains: '  discord ' } })).toEqual({
			answers: [{ questionId: 'q-referral', contains: 'discord' }]
		});
	});

	it('omits a substring box holding only whitespace', () => {
		// Not a narrowing selection, and `contains: ''` would match every answered row
		// while reading on screen as an engaged filter.
		expect(facetParams({ [REFERRAL]: { contains: '   ' } })).toEqual({});
	});

	it('sends either end of a range on its own', () => {
		expect(facetParams({ [HACKATHONS]: { min: 3 } })).toEqual({
			answers: [{ questionId: 'q-hackathons', min: 3 }]
		});
		expect(facetParams({ [HACKATHONS]: { max: 3 } })).toEqual({
			answers: [{ questionId: 'q-hackathons', max: 3 }]
		});
	});

	it('keeps a zero bound, which is a bound like any other', () => {
		// `if (min)` would drop it; the check has to be against undefined.
		expect(facetParams({ [HACKATHONS]: { min: 0, max: 0 } })).toEqual({
			answers: [{ questionId: 'q-hackathons', min: 0, max: 0 }]
		});
	});

	it('collects every engaged question into one answers array', () => {
		const params = facetParams({
			[REFERRAL]: { contains: 'discord' },
			[HACKATHONS]: { min: 1 }
		});
		expect(params.answers).toHaveLength(2);
	});

	it('sends the state facet as its own key, sentinels included', () => {
		expect(facetParams({ [STATE_FACET_KEY]: { values: ['TX', OUT_OF_STATE] } })).toEqual({
			states: ['TX', OUT_OF_STATE]
		});
	});
});

describe('buildRecipientParams — application facets', () => {
	it('sends no facet keys when the filters are untouched', () => {
		// The empty-vs-omitted regression, at the level the pages actually call.
		const params = buildRecipientParams(...everything());
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('carries a facet selection onto the wire keys', () => {
		const params = buildRecipientParams(...everything(), '', { [YEAR]: { values: ['Senior'] } });
		expect(params.years).toEqual(['Senior']);
	});

	it('ANDs a facet filter with an engaged checkbox group', () => {
		// Two independent filters in one params object: the server ANDs them, so both
		// have to survive the translation.
		const [, statuses, decisions, pending] = everything();
		const params = buildRecipientParams(
			Object.fromEntries(ALL_ROLES.map((r) => [r, r === Role.HACKER])),
			statuses,
			decisions,
			pending,
			'',
			{ [YEAR]: { values: ['Senior'] } }
		);
		expect(params.roles).toEqual([Role.HACKER]);
		expect(params.years).toEqual(['Senior']);
	});

	it('leaves the checkbox groups omitted when every box is checked', () => {
		const params = buildRecipientParams(...everything(), '', {
			[UNIVERSITY]: { values: ['Rice University'] }
		});
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
			includeNoDecision: undefined,
			pendingDecisions: undefined,
			includeNoPending: undefined
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
	 * A cleared group filters nothing. It must omit its keys rather than send `[]`, which
	 * `$lib/server/recipients` reads as match-nobody.
	 */
	it('omits the decision keys when every box is unchecked', () => {
		const [roles, statuses] = everything();
		const params = buildRecipientParams(roles, statuses, cleared(DECISION_OPTIONS));
		expect(params.decisions).toBeUndefined();
		expect(params.includeNoDecision).toBeUndefined();
	});

	/**
	 * The reported bug. Clearing all three groups and ticking one role returned zero rows:
	 * the emptied decision group contributed `uid: IMPOSSIBLE_NO_MATCH`.
	 */
	it('selects a role after every group has been cleared', () => {
		const params = buildRecipientParams(
			{ ...cleared(ALL_ROLES), [Role.ORGANIZER]: true },
			cleared(ALL_STATUSES),
			cleared(DECISION_OPTIONS)
		);
		expect(params).toEqual({
			search: undefined,
			roles: [Role.ORGANIZER],
			statuses: undefined,
			decisions: undefined,
			includeNoDecision: undefined,
			pendingDecisions: undefined,
			includeNoPending: undefined
		});
	});

	it('omits the role and status keys when their groups are cleared', () => {
		const [, , decisions] = everything();
		const params = buildRecipientParams(cleared(ALL_ROLES), cleared(ALL_STATUSES), decisions);
		expect(params.roles).toBeUndefined();
		expect(params.statuses).toBeUndefined();
	});

	/** Still narrowing, so the keys still travel — including the `false` for `NONE`. */
	it('sends a partial decision selection', () => {
		const [roles, statuses] = everything();
		const params = buildRecipientParams(roles, statuses, {
			...cleared(DECISION_OPTIONS),
			[DecisionStatus.ACCEPTED]: true
		});
		expect(params.decisions).toEqual([DecisionStatus.ACCEPTED]);
		expect(params.includeNoDecision).toBe(false);
	});

	it('separates the synthetic no-decision option from the real statuses', () => {
		const [roles, statuses, decisions] = everything();
		const params = buildRecipientParams(roles, statuses, { ...decisions, [NO_DECISION]: false });
		expect(params.decisions).toEqual(DECIDABLE_VALUES);
		expect(params.includeNoDecision).toBe(false);
		expect(params.decisions).not.toContain(NO_DECISION as unknown as DecisionStatus);
	});

	/** The pending group narrows independently of the released one. */
	it('sends a partial pending-decision selection without touching the released keys', () => {
		const [roles, statuses, decisions] = everything();
		const params = buildRecipientParams(roles, statuses, decisions, {
			...cleared(DECISION_OPTIONS),
			[DecisionStatus.ACCEPTED]: true
		});
		expect(params.pendingDecisions).toEqual([DecisionStatus.ACCEPTED]);
		expect(params.includeNoPending).toBe(false);
		expect(params.decisions).toBeUndefined();
		expect(params.includeNoDecision).toBeUndefined();
	});

	it('omits the pending keys when that group is cleared or untouched', () => {
		const [roles, statuses, decisions] = everything();
		const untouched = buildRecipientParams(roles, statuses, decisions);
		expect(untouched.pendingDecisions).toBeUndefined();
		expect(untouched.includeNoPending).toBeUndefined();

		const emptied = buildRecipientParams(roles, statuses, decisions, cleared(DECISION_OPTIONS));
		expect(emptied.pendingDecisions).toBeUndefined();
		expect(emptied.includeNoPending).toBeUndefined();
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

describe('parseEmailCsv', () => {
	it('reads one address per row, lowercasing and deduplicating', () => {
		expect(parseEmailCsv('A@x.com\r\nb@x.com\r\na@X.com')).toEqual({
			emails: ['a@x.com', 'b@x.com'],
			invalid: []
		});
	});

	it('skips a header cell', () => {
		expect(parseEmailCsv('Email\na@x.com').emails).toEqual(['a@x.com']);
	});

	it('reads every column, and several addresses inside one quoted cell', () => {
		expect(parseEmailCsv('a@x.com,b@x.com\n"c@x.com, d@x.com"').emails).toEqual([
			'a@x.com',
			'b@x.com',
			'c@x.com',
			'd@x.com'
		]);
	});

	it('reports cells that are not addresses instead of dropping them', () => {
		expect(parseEmailCsv('a@x.com\nnope\nb@x\nc@x.com')).toEqual({
			emails: ['a@x.com', 'c@x.com'],
			invalid: ['nope', 'b@x']
		});
	});

	it('returns nothing for an empty file', () => {
		expect(parseEmailCsv('')).toEqual({ emails: [], invalid: [] });
	});
});
