import { describe, it, expect } from 'vitest';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { buildRecipientWhere } from './recipients';
import { parseEmailList, malformedEmails } from '$lib/admin/filters';

/** The AND conditions, or [] when the predicate is match-everyone. */
function conditions(where: ReturnType<typeof buildRecipientWhere>) {
	return (where.AND ?? []) as Record<string, unknown>[];
}

describe('buildRecipientWhere — empty-selection contract', () => {
	it('matches everyone when no filter keys are supplied', () => {
		// The dangerous default. Callers that SEND must gate on the resulting count.
		expect(buildRecipientWhere({})).toEqual({});
	});

	it('matches nothing when the decision filter is engaged but nothing is selected', () => {
		// This is the regression that matters: browse and send must agree here.
		// Previously user.list matched nothing while sendCustom matched EVERYONE,
		// so a UI reading one and calling the other would mail the whole database.
		expect(buildRecipientWhere({ decisions: [], includeNoDecision: false })).toEqual({
			AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }]
		});
	});

	it('matches nothing when decisions is an empty array alone', () => {
		expect(buildRecipientWhere({ decisions: [] })).toEqual({
			AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }]
		});
	});

	it('does not engage the decision filter when both decision keys are absent', () => {
		const where = buildRecipientWhere({ roles: [Role.HACKER] });
		expect(conditions(where)).toEqual([{ roles: { hasSome: [Role.HACKER] } }]);
	});

	it('treats an empty roles array as "no role filter", not "no one"', () => {
		// Asymmetric with decisions on purpose — roles/statuses have no explicit
		// "engaged" signal, so an empty array can only mean "unfiltered".
		expect(buildRecipientWhere({ roles: [], statuses: [] })).toEqual({});
	});
});

describe('buildRecipientWhere — explicit email list', () => {
	it('selects exactly the given addresses', () => {
		expect(conditions(buildRecipientWhere({ emails: ['a@x.com', 'b@x.com'] }))).toEqual([
			{ email: { in: ['a@x.com', 'b@x.com'] } }
		]);
	});

	it('matches nothing for an empty address list', () => {
		// Same engaged-but-empty rule as decisions: an emptied textarea must not
		// silently fall back to "everyone".
		expect(buildRecipientWhere({ emails: [] })).toEqual({
			AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }]
		});
	});

	it('intersects with other filters rather than replacing them', () => {
		const cond = conditions(buildRecipientWhere({ emails: ['a@x.com'], roles: [Role.HACKER] }));
		expect(cond).toHaveLength(2);
	});
});

describe('parseEmailList / malformedEmails', () => {
	it('splits on commas, semicolons, and newlines', () => {
		expect(parseEmailList('a@x.com, b@x.com;c@x.com\nd@x.com')).toEqual([
			'a@x.com',
			'b@x.com',
			'c@x.com',
			'd@x.com'
		]);
	});

	it('lowercases and deduplicates', () => {
		expect(parseEmailList('A@x.com, a@X.com')).toEqual(['a@x.com']);
	});

	it('ignores empty fragments and stray separators', () => {
		expect(parseEmailList('  , ,a@x.com,,  ')).toEqual(['a@x.com']);
	});

	it('returns nothing for a blank blob', () => {
		expect(parseEmailList('   \n  ')).toEqual([]);
	});

	it('flags entries that are not addresses', () => {
		expect(malformedEmails(['a@x.com', 'nope', 'no@domain', '@x.com'])).toEqual([
			'nope',
			'no@domain',
			'@x.com'
		]);
	});
});

describe('buildRecipientWhere — predicate shapes', () => {
	it('uses hasSome for roles, since User.roles is a list', () => {
		expect(conditions(buildRecipientWhere({ roles: [Role.HACKER, Role.MENTOR] }))).toEqual([
			{ roles: { hasSome: [Role.HACKER, Role.MENTOR] } }
		]);
	});

	it('uses in for statuses', () => {
		expect(conditions(buildRecipientWhere({ statuses: [UserStatus.APPLIED] }))).toEqual([
			{ status: { in: [UserStatus.APPLIED] } }
		]);
	});

	it('filters decisions on activeDecision, never pendingDecision', () => {
		const cond = conditions(buildRecipientWhere({ decisions: [DecisionStatus.ACCEPTED] }));
		expect(cond).toEqual([{ activeDecision: { in: [DecisionStatus.ACCEPTED] } }]);
		expect(JSON.stringify(cond)).not.toContain('pendingDecision');
	});

	it('ORs in undecided users when includeNoDecision is set alongside decisions', () => {
		expect(
			conditions(
				buildRecipientWhere({ decisions: [DecisionStatus.ACCEPTED], includeNoDecision: true })
			)
		).toEqual([
			{
				OR: [{ activeDecision: { in: [DecisionStatus.ACCEPTED] } }, { activeDecision: null }]
			}
		]);
	});

	it('selects only undecided users when includeNoDecision stands alone', () => {
		expect(conditions(buildRecipientWhere({ includeNoDecision: true }))).toEqual([
			{ activeDecision: null }
		]);
	});

	it('searches name and email case-insensitively', () => {
		expect(conditions(buildRecipientWhere({ search: 'ada' }))).toEqual([
			{
				OR: [
					{ name: { contains: 'ada', mode: 'insensitive' } },
					{ email: { contains: 'ada', mode: 'insensitive' } }
				]
			}
		]);
	});

	it('stacks independent filters under AND', () => {
		const where = buildRecipientWhere({
			search: 'ada',
			roles: [Role.HACKER],
			statuses: [UserStatus.APPLIED],
			decisions: [DecisionStatus.ACCEPTED]
		});
		expect(conditions(where)).toHaveLength(4);
	});
});
