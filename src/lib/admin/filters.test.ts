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

/** Every box in the group unticked. The panels' `clear` resets to all ticked instead,
 * but the state is still reachable by unticking boxes one at a time. */
const cleared = (options: readonly string[]) => Object.fromEntries(options.map((o) => [o, false]));

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
		const params = linkedParams({ UNIVERSITY: [], YEAR: [], NAME: [] });
		for (const key of LINKED_KEYS) expect(params).not.toHaveProperty(key);
	});

	it('sends only the fields that have a selection', () => {
		expect(linkedParams({ YEAR: ['Senior'], UNIVERSITY: [] })).toEqual({ years: ['Senior'] });
	});

	it('maps each linked field to its plural wire key', () => {
		expect(
			linkedParams({ NAME: ['Ada Lovelace'], UNIVERSITY: ['Rice University'], YEAR: ['Senior'] })
		).toEqual({
			names: ['Ada Lovelace'],
			universities: ['Rice University'],
			years: ['Senior']
		});
	});

	it('passes the no-value sentinel through untouched', () => {
		// The sentinel is a selection like any other — splitting it out is the server's job.
		expect(linkedParams({ UNIVERSITY: [NO_VALUE] })).toEqual({ universities: [NO_VALUE] });
	});

	it('copies the arrays instead of aliasing the caller state', () => {
		const selection: LinkedSelection = { YEAR: ['Senior'] };
		const params = linkedParams(selection);
		selection.YEAR?.push('Junior');
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
		const params = buildRecipientParams(...everything(), '', { YEAR: ['Senior'] });
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
			{ YEAR: ['Senior'] }
		);
		expect(params.roles).toEqual([Role.HACKER]);
		expect(params.years).toEqual(['Senior']);
	});

	it('leaves the checkbox groups omitted when every box is checked', () => {
		const params = buildRecipientParams(...everything(), '', { UNIVERSITY: ['Rice University'] });
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
	 * A cleared group filters nothing. It must omit its keys rather than send `[]`,
	 * which `$lib/server/recipients` reads as match-nobody — that is what made clicking
	 * `clear` under Decision empty the Users table.
	 */
	it('omits the decision keys when every box is unchecked', () => {
		const [roles, statuses] = everything();
		const params = buildRecipientParams(roles, statuses, cleared(DECISION_OPTIONS));
		expect(params.decisions).toBeUndefined();
		expect(params.includeNoDecision).toBeUndefined();
	});

	/**
	 * The reported bug. Clearing all three groups and ticking one role returned zero
	 * rows: the emptied decision group contributed `uid: IMPOSSIBLE_NO_MATCH`, which
	 * ANDed with the role clause and matched nobody.
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
			includeNoDecision: undefined
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
