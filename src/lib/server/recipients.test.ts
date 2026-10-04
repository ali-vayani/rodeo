import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import {
	buildRecipientWhere,
	splitExplicitEmails,
	EXTERNAL_RECIPIENT_PREFIX,
	expandSearch,
	resolveRecipientWhere,
	linkedFieldConditions,
	recipientConditions,
	resolveAnswerConditions,
	whereFromConditions,
	searchCondition,
	MAX_FUZZY_NAMES,
	EXACT_MATCH_FLOOR,
	NO_EXPANSION,
	SEARCH_SIMILARITY_THRESHOLD
} from './recipients';
import { NO_VALUE } from '$lib/facets';
import { parseEmailList } from '$lib/admin/filters';
import { malformedEmails } from '$lib/email/address';

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
		// The regression that matters: browse and send must agree here. `user.list` used to
		// match nothing while `sendCustom` matched everyone.
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
		expect(conditions(where)).toEqual([{ role: { in: [Role.HACKER] } }]);
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

describe('splitExplicitEmails', () => {
	it('returns the addresses that matched no user', () => {
		expect(splitExplicitEmails(['a@x.com', 'ghost@x.com'], [{ email: 'a@x.com' }])).toEqual({
			external: ['ghost@x.com'],
			invalid: []
		});
	});

	it('drops an address that belongs to a user, so it is mailed once as that user', () => {
		// The dedupe that keeps {{name}} personalising: a pasted address matching a
		// hacker must go out through the user path, not twice.
		expect(splitExplicitEmails(['a@x.com'], [{ email: 'a@x.com' }]).external).toEqual([]);
	});

	it('matches users case-insensitively, the way buildRecipientWhere does', () => {
		// A stored `a@x.com` against a pasted `A@X.com` must not become "external".
		expect(splitExplicitEmails(['A@X.com'], [{ email: 'a@x.com' }]).external).toEqual([]);
	});

	it('deduplicates repeated externals so one address is one message', () => {
		expect(
			splitExplicitEmails(['ghost@x.com', 'GHOST@x.com ', 'ghost@x.com'], []).external
		).toEqual(['ghost@x.com']);
	});

	it('rejects addresses that are not addresses rather than mailing them', () => {
		// Server-side validation: the client filters these out first, but with the
		// toggle on this list becomes envelope addresses, so it is re-checked here.
		expect(splitExplicitEmails(['ok@x.com', 'nope', 'no@domain'], [])).toEqual({
			external: ['ok@x.com'],
			invalid: ['nope', 'no@domain']
		});
	});

	it('returns nothing for an absent or empty list', () => {
		expect(splitExplicitEmails(undefined, [])).toEqual({ external: [], invalid: [] });
		expect(splitExplicitEmails([], [])).toEqual({ external: [], invalid: [] });
	});

	it('marks external EmailLog entries with a prefix a cuid cannot produce', () => {
		// EmailLog.userIds holds uids; an address has to stay distinguishable from one.
		expect(EXTERNAL_RECIPIENT_PREFIX).toContain(':');
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
	it('uses `in` for roles, since each user holds exactly one', () => {
		expect(conditions(buildRecipientWhere({ roles: [Role.HACKER, Role.MENTOR] }))).toEqual([
			{ role: { in: [Role.HACKER, Role.MENTOR] } }
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

	it('filters pending decisions on pendingDecision, independent of the released filter', () => {
		const cond = conditions(buildRecipientWhere({ pendingDecisions: [DecisionStatus.ACCEPTED] }));
		expect(cond).toEqual([{ pendingDecision: { in: [DecisionStatus.ACCEPTED] } }]);
		expect(JSON.stringify(cond)).not.toContain('activeDecision');
	});

	it('reads a literal PENDING as "no pending decision" alongside null', () => {
		// PENDING is the enum's starting value; setDecision refuses to write it, so it
		// means the same thing as an untouched null.
		expect(
			conditions(
				buildRecipientWhere({ pendingDecisions: [DecisionStatus.ACCEPTED], includeNoPending: true })
			)
		).toEqual([
			{
				OR: [
					{ pendingDecision: { in: [DecisionStatus.ACCEPTED] } },
					{ pendingDecision: null },
					{ pendingDecision: DecisionStatus.PENDING }
				]
			}
		]);
	});

	it('ANDs the pending and released filters so "pending accept" can be isolated', () => {
		expect(
			conditions(
				buildRecipientWhere({
					pendingDecisions: [DecisionStatus.ACCEPTED],
					includeNoDecision: true
				})
			)
		).toEqual([{ activeDecision: null }, { pendingDecision: { in: [DecisionStatus.ACCEPTED] } }]);
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

describe('buildRecipientWhere — linked application fields', () => {
	it('does not engage a linked filter that was not supplied', () => {
		expect(buildRecipientWhere({ universities: undefined })).toEqual({});
	});

	it('selects exactly the chosen values', () => {
		expect(conditions(buildRecipientWhere({ universities: ['UT Austin', 'Rice'] }))).toEqual([
			{ university: { in: ['UT Austin', 'Rice'] } }
		]);
	});

	it('matches NOTHING when a linked filter is engaged but empty', () => {
		// `buildRecipientWhere` is shared by browse and send, so an empty selection that
		// fell through to "no clause" would mean a UI reading "0 recipients" mails everyone.
		for (const filters of [{ names: [] }, { universities: [] }, { years: [] }]) {
			expect(buildRecipientWhere(filters)).toEqual({ AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }] });
		}
	});

	it('uses the same match-nothing sentinel as the decision filter', () => {
		expect(buildRecipientWhere({ years: [] })).toEqual(
			buildRecipientWhere({ decisions: [], includeNoDecision: false })
		);
	});

	it('ANDs one condition per engaged linked filter, so an empty one poisons the rest', () => {
		const cond = conditions(buildRecipientWhere({ universities: ['Rice'], years: [] }));
		expect(cond).toEqual([{ university: { in: ['Rice'] } }, { uid: 'IMPOSSIBLE_NO_MATCH' }]);
	});
});

describe('buildRecipientWhere — the NO_VALUE sentinel', () => {
	it('selects exactly the users with no value when chosen alone', () => {
		// Both spellings of absent: application.save does not trim, so a blank answer
		// is stored as '' rather than leaving the column NULL.
		expect(conditions(buildRecipientWhere({ universities: [NO_VALUE] }))).toEqual([
			{ OR: [{ university: null }, { university: '' }] }
		]);
	});

	it('ORs the absent case in alongside real values', () => {
		expect(conditions(buildRecipientWhere({ years: ['Senior', NO_VALUE] }))).toEqual([
			{ OR: [{ year: { in: ['Senior'] } }, { year: null }, { year: '' }] }
		]);
	});

	it('never puts the sentinel into the IN list', () => {
		const cond = conditions(buildRecipientWhere({ years: ['Senior', NO_VALUE] }));
		expect(JSON.stringify(cond)).not.toContain(JSON.stringify(NO_VALUE));
	});

	it('omits the NULL branch for name, which is NOT NULL in the schema', () => {
		// Prisma rejects `{ name: null }` at runtime for a non-nullable column, and a
		// NULL name cannot exist for the facet to have counted one anyway.
		expect(conditions(buildRecipientWhere({ names: [NO_VALUE] }))).toEqual([{ name: '' }]);
	});
});

describe('linkedFieldConditions', () => {
	it('returns nothing when no linked key is supplied', () => {
		expect(linkedFieldConditions({})).toEqual([]);
	});

	it('is the same clause admissions and recipients both use', () => {
		// The two predicates are separate on purpose (admissions reads pendingDecision
		// too) but must not drift on this part again.
		expect(linkedFieldConditions({ years: ['Senior'] })).toEqual(
			conditions(buildRecipientWhere({ years: ['Senior'] }))
		);
	});
});

describe('buildRecipientWhere — combined filters', () => {
	it('ANDs linked fields with the rest rather than replacing them', () => {
		const cond = conditions(
			buildRecipientWhere({
				search: 'ada',
				roles: [Role.HACKER],
				statuses: [UserStatus.APPLIED],
				decisions: [DecisionStatus.ACCEPTED],
				universities: ['Rice'],
				years: ['Senior', NO_VALUE]
			})
		);
		expect(cond).toHaveLength(6);
		expect(cond).toContainEqual({ university: { in: ['Rice'] } });
		expect(cond).toContainEqual({ role: { in: [Role.HACKER] } });
	});
});

/** A prisma stand-in for `expandSearch`: a fixed roster, counted and scanned. */
function fakePrisma(names: string[], exactMatches: number) {
	const calls = {
		count: 0,
		findMany: 0,
		probeWhere: undefined as unknown,
		candidateWhere: undefined as unknown
	};
	const prisma = {
		user: {
			count: async (args: { where?: unknown }) => {
				calls.count++;
				calls.probeWhere = args?.where;
				return exactMatches;
			},
			findMany: async (args: { where?: unknown }) => {
				calls.findMany++;
				calls.candidateWhere = args.where;
				return names.map((name) => ({ name }));
			},
			// Only the state facet groups users, and none of these cases engage it.
			groupBy: async () => []
		},
		// `resolveRecipientWhere` resolves the answer filters too. Present so the type
		// matches; unreached, because none of these cases carries an `answers` key.
		applicationResponse: { groupBy: async () => [] },
		settings: { findFirst: async () => null },
		question: { findMany: async () => [] }
	} as unknown as Pick<PrismaClient, 'user' | 'applicationResponse' | 'settings' | 'question'>;
	return { prisma, calls };
}

const ROSTER = ['Sarah Chen', 'Maria Rodriguez', 'Ada Lovelace', 'Jay Patil'];

describe('expandSearch — exact first, fuzzy only as a fallback', () => {
	it('returns nothing when there is no search term', async () => {
		const { prisma, calls } = fakePrisma(ROSTER, 0);
		expect(await expandSearch(prisma, undefined)).toEqual(NO_EXPANSION);
		expect(calls.count).toBe(0);
	});

	it('returns nothing when the exact substring search already matches', async () => {
		// A good query is never slowed or altered — this is what keeps the feature from
		// changing results that were already correct.
		const { prisma, calls } = fakePrisma(ROSTER, EXACT_MATCH_FLOOR);
		expect(await expandSearch(prisma, 'chen')).toEqual({
			...NO_EXPANSION,
			exact: EXACT_MATCH_FLOOR
		});
		expect(calls.findMany).toBe(0);
	});

	it('folds the roster in memory when the exact search matches nobody', async () => {
		const { prisma } = fakePrisma(ROSTER, 0);
		const expansion = await expandSearch(prisma, 'Sarh');
		expect(expansion).toEqual({ names: ['Sarah Chen'], fuzzy: true, capped: false, exact: 0 });
	});

	it('matches a single typed word against one token of a full name', async () => {
		const { prisma } = fakePrisma(ROSTER, 0);
		expect((await expandSearch(prisma, 'Rodrigez')).names).toEqual(['Maria Rodriguez']);
	});

	it('returns no names when nothing clears the threshold', async () => {
		const { prisma } = fakePrisma(ROSTER, 0);
		const expansion = await expandSearch(prisma, 'Zzzqqq');
		expect(expansion).toEqual({ names: [], fuzzy: true, capped: false, exact: 0 });
	});

	it('orders by score, so the closest suggestion survives the cap', async () => {
		// `Patell` rather than `Patel`, because a candidate spelled exactly like the query
		// is no longer a suggestion at all — the substring clause already selected it. The
		// property under test is unchanged: of two names that both clear the threshold,
		// the better score leads, and that is what survives truncation at the cap.
		const { prisma } = fakePrisma(['Patil', 'Patel'], 0);
		expect((await expandSearch(prisma, 'Patell')).names).toEqual(['Patel', 'Patil']);
	});

	it('treats a whitespace-only term as no search at all', async () => {
		const { prisma, calls } = fakePrisma(ROSTER, 0);
		expect(await expandSearch(prisma, '   ')).toEqual(NO_EXPANSION);
		expect(calls.count).toBe(0);
	});
});

describe('expandSearch — the cap', () => {
	const crowd = Array.from({ length: MAX_FUZZY_NAMES + 5 }, (_, i) => `Sarah Chen ${i}`);

	it('truncates the resolved set to the cap', async () => {
		const { prisma } = fakePrisma(crowd, 0);
		const expansion = await expandSearch(prisma, 'Sarh Chen');
		expect(expansion.names).toHaveLength(MAX_FUZZY_NAMES);
	});

	it('reports the truncation rather than swallowing it', async () => {
		const { prisma } = fakePrisma(crowd, 0);
		expect((await expandSearch(prisma, 'Sarh Chen')).capped).toBe(true);
	});

	it('does not claim a cap when the whole set fits', async () => {
		const { prisma } = fakePrisma(ROSTER, 0);
		expect((await expandSearch(prisma, 'Sarh')).capped).toBe(false);
	});
});

describe('searchCondition', () => {
	it('is null without a search term, so no clause is added', () => {
		expect(searchCondition(undefined)).toBeNull();
	});

	it('is the exact substring clause when nothing was expanded', () => {
		expect(searchCondition('ada')).toEqual({
			OR: [
				{ name: { contains: 'ada', mode: 'insensitive' } },
				{ email: { contains: 'ada', mode: 'insensitive' } }
			]
		});
	});

	it('ORs the fuzzy names in as exact values, never as a score', () => {
		// Fuzziness is resolved before the predicate is built. A predicate that scored
		// rows could not be reproduced identically by preview and send.
		const where = searchCondition('sarh', {
			names: ['Sarah Chen'],
			fuzzy: true,
			capped: false,
			exact: 0
		});
		expect(where).toEqual({
			OR: [
				{ name: { contains: 'sarh', mode: 'insensitive' } },
				{ email: { contains: 'sarh', mode: 'insensitive' } },
				{ name: { in: ['Sarah Chen'] } }
			]
		});
	});
});

/**
 * A prisma stand-in for the answer filters: distinct answers per question, plus the
 * Settings row the state filter reads its home state from.
 */
function answerPrisma(
	values: string[] = [],
	homeState: string | null = null,
	multiSelectIds: string[] = []
) {
	const calls = { groupBy: 0, settings: 0 };
	return {
		calls,
		prisma: {
			applicationResponse: {
				groupBy: async () => {
					calls.groupBy++;
					return values.map((value) => ({ value }));
				}
			},
			settings: {
				findFirst: async () => {
					calls.settings++;
					return { homeState };
				}
			},
			user: { groupBy: async () => [] },
			// Which questions store a set. Empty means every filtered question is
			// single-select, which is what the cases below assume unless they say otherwise.
			question: { findMany: async () => multiSelectIds.map((id) => ({ id })) }
		} as unknown as Pick<PrismaClient, 'user' | 'applicationResponse' | 'settings' | 'question'>
	};
}

const QUESTION = 'q-hackathons';

describe('resolveAnswerConditions — values', () => {
	it('adds no condition at all for an absent key', async () => {
		expect(await resolveAnswerConditions(answerPrisma().prisma, {})).toEqual([]);
	});

	it('skips an entry whose controls are all untouched', async () => {
		// A facet the panel is holding open, not a selection anyone made. Treating it as
		// engaged-but-empty would empty the table for merely expanding a filter.
		expect(
			await resolveAnswerConditions(answerPrisma().prisma, { answers: [{ questionId: QUESTION }] })
		).toEqual([]);
	});

	it('matches nobody for an engaged-but-empty value list', async () => {
		// The rule the linked fields and the decision pair already follow. Getting it
		// backwards on the send path is how a UI reading "0 recipients" mails everyone.
		expect(
			await resolveAnswerConditions(answerPrisma().prisma, {
				answers: [{ questionId: QUESTION, values: [] }]
			})
		).toEqual([{ uid: 'IMPOSSIBLE_NO_MATCH' }]);
	});

	it('selects the users holding one of the chosen answers', async () => {
		expect(
			await resolveAnswerConditions(answerPrisma().prisma, {
				answers: [{ questionId: QUESTION, values: ['Yes', 'Maybe'] }]
			})
		).toEqual([
			{ application: { some: { questionId: QUESTION, value: { in: ['Yes', 'Maybe'] } } } }
		]);
	});

	it('reads the no-value sentinel as both spellings of unanswered', async () => {
		// A question added after someone applied leaves no row; a field opened and
		// cleared leaves one holding ''. Counting only the first misses half of them.
		const [condition] = await resolveAnswerConditions(answerPrisma().prisma, {
			answers: [{ questionId: QUESTION, values: [NO_VALUE] }]
		});
		expect(condition).toEqual({
			OR: [
				{ application: { none: { questionId: QUESTION } } },
				{ application: { some: { questionId: QUESTION, value: '' } } }
			]
		});
	});

	it('ORs the sentinel alongside real values', async () => {
		const [condition] = await resolveAnswerConditions(answerPrisma().prisma, {
			answers: [{ questionId: QUESTION, values: ['Yes', NO_VALUE] }]
		});
		expect(condition).toEqual({
			OR: [
				{ application: { some: { questionId: QUESTION, value: { in: ['Yes'] } } } },
				{ application: { none: { questionId: QUESTION } } },
				{ application: { some: { questionId: QUESTION, value: '' } } }
			]
		});
	});

	it('ANDs one condition per engaged question, so they stack', async () => {
		const conds = await resolveAnswerConditions(answerPrisma().prisma, {
			answers: [
				{ questionId: 'q-a', values: ['Yes'] },
				{ questionId: 'q-b', values: ['No'] }
			]
		});
		expect(conds).toHaveLength(2);
	});
});

describe('resolveAnswerConditions — multi-select', () => {
	it('matches an option inside the stored set, not the whole set', () => {
		// An `IN` on the encoded value would only match someone who picked exactly Rust
		// and nothing else — so every multi-select filter would quietly return nobody.
		return expect(
			resolveAnswerConditions(answerPrisma([], null, [QUESTION]).prisma, {
				answers: [{ questionId: QUESTION, values: ['Rust', 'Go'] }]
			})
		).resolves.toEqual([
			{
				application: {
					some: {
						questionId: QUESTION,
						OR: [{ value: { contains: '"Rust"' } }, { value: { contains: '"Go"' } }]
					}
				}
			}
		]);
	});

	it('still reads the sentinel as unanswered', async () => {
		// An empty selection stores '', the same blank every other type clears to, so the
		// no-value arm needs no multi-select spelling of its own.
		const [condition] = await resolveAnswerConditions(answerPrisma([], null, [QUESTION]).prisma, {
			answers: [{ questionId: QUESTION, values: ['Rust', NO_VALUE] }]
		});
		expect(condition).toEqual({
			OR: [
				{
					application: {
						some: { questionId: QUESTION, OR: [{ value: { contains: '"Rust"' } }] }
					}
				},
				{ application: { none: { questionId: QUESTION } } },
				{ application: { some: { questionId: QUESTION, value: '' } } }
			]
		});
	});

	it('leaves single-select questions on the exact `IN` they have always used', async () => {
		// The lookup exists so the common case keeps its indexed match. A substring
		// predicate over every answer would be both slower and laxer than what was asked.
		const { prisma } = answerPrisma([], null, ['q-other']);
		expect(
			await resolveAnswerConditions(prisma, {
				answers: [{ questionId: QUESTION, values: ['Yes'] }]
			})
		).toEqual([{ application: { some: { questionId: QUESTION, value: { in: ['Yes'] } } } }]);
	});
});

describe('resolveAnswerConditions — substring', () => {
	it('matches case-insensitively on the answer', async () => {
		expect(
			await resolveAnswerConditions(answerPrisma().prisma, {
				answers: [{ questionId: QUESTION, contains: 'discord' }]
			})
		).toEqual([
			{
				application: {
					some: { questionId: QUESTION, value: { contains: 'discord', mode: 'insensitive' } }
				}
			}
		]);
	});

	it('ignores a term that is only whitespace', async () => {
		// `contains: ''` matches every answered row, which is the opposite of what an
		// admin who typed a space and deleted it is asking for.
		expect(
			await resolveAnswerConditions(answerPrisma().prisma, {
				answers: [{ questionId: QUESTION, contains: '   ' }]
			})
		).toEqual([]);
	});
});

describe('resolveAnswerConditions — numeric range', () => {
	it('resolves the range to the explicit answers that satisfy it', async () => {
		// Answers are text, so `value >= 18` would compare "9" against "18" as strings.
		// The range is folded to exact values before it reaches the predicate — the same
		// move `expandSearch` makes, and what keeps preview and send identical.
		const { prisma } = answerPrisma(['0', '2', '5', '12']);
		expect(
			await resolveAnswerConditions(prisma, { answers: [{ questionId: QUESTION, min: 2, max: 5 }] })
		).toEqual([{ application: { some: { questionId: QUESTION, value: { in: ['2', '5'] } } } }]);
	});

	it('treats either end as unbounded when it is omitted', async () => {
		const { prisma } = answerPrisma(['0', '2', '5', '12']);
		const [atLeast] = await resolveAnswerConditions(prisma, {
			answers: [{ questionId: QUESTION, min: 5 }]
		});
		expect(atLeast).toEqual({
			application: { some: { questionId: QUESTION, value: { in: ['5', '12'] } } }
		});
	});

	it('honours a bound of zero rather than reading it as absent', async () => {
		const { prisma } = answerPrisma(['0', '2']);
		const [exactlyZero] = await resolveAnswerConditions(prisma, {
			answers: [{ questionId: QUESTION, min: 0, max: 0 }]
		});
		expect(exactlyZero).toEqual({
			application: { some: { questionId: QUESTION, value: { in: ['0'] } } }
		});
	});

	it('drops answers that are not numbers at all', async () => {
		// A question that was short text before an organizer changed its type.
		const { prisma } = answerPrisma(['twenty', '', '3']);
		const [condition] = await resolveAnswerConditions(prisma, {
			answers: [{ questionId: QUESTION, min: 0, max: 100 }]
		});
		expect(condition).toEqual({
			application: { some: { questionId: QUESTION, value: { in: ['3'] } } }
		});
	});

	it('matches nobody when no answer falls in the range', async () => {
		// Still a narrowing selection, so it must not drop out and match everybody.
		const { prisma } = answerPrisma(['1', '2']);
		expect(
			await resolveAnswerConditions(prisma, { answers: [{ questionId: QUESTION, min: 90 }] })
		).toEqual([{ uid: 'IMPOSSIBLE_NO_MATCH' }]);
	});
});

describe('resolveAnswerConditions — states', () => {
	it('adds nothing, and reads no settings, when the filter is absent', async () => {
		const { prisma, calls } = answerPrisma();
		expect(await resolveAnswerConditions(prisma, {})).toEqual([]);
		expect(calls.settings).toBe(0);
	});

	it('matches nobody for an engaged-but-empty state selection', async () => {
		const { prisma, calls } = answerPrisma();
		expect(await resolveAnswerConditions(prisma, { states: [] })).toEqual([
			{ uid: 'IMPOSSIBLE_NO_MATCH' }
		]);
		// And still costs no Settings lookup — there is no home state to resolve.
		expect(calls.settings).toBe(0);
	});
});

describe('resolveRecipientWhere', () => {
	it('produces the same predicate for the same input, every time', async () => {
		// The property `previewRecipients` and `sendCustom` are both built on: same
		// input, same recipient set, so the expectedCount drift check only fires on a
		// set that genuinely changed.
		const a = await resolveRecipientWhere(fakePrisma(ROSTER, 0).prisma, { search: 'Sarh' });
		const b = await resolveRecipientWhere(fakePrisma(ROSTER, 0).prisma, { search: 'Sarh' });
		expect(a.where).toEqual(b.where);
		expect(a.where).toEqual(
			buildRecipientWhere(
				{ search: 'Sarh' },
				{ names: ['Sarah Chen'], fuzzy: true, capped: false, exact: 0 }
			)
		);
	});

	it('leaves an exactly-matching search untouched', async () => {
		const { where, expansion } = await resolveRecipientWhere(
			fakePrisma(ROSTER, EXACT_MATCH_FLOOR).prisma,
			{ search: 'Chen' }
		);
		expect(expansion).toEqual({ ...NO_EXPANSION, exact: EXACT_MATCH_FLOOR });
		expect(where).toEqual(buildRecipientWhere({ search: 'Chen' }));
	});

	it('still honours the match-nothing rule when a fuzzy search is combined with one', async () => {
		const { where } = await resolveRecipientWhere(fakePrisma(ROSTER, 0).prisma, {
			search: 'Sarh',
			universities: []
		});
		expect(conditions(where)).toContainEqual({ uid: 'IMPOSSIBLE_NO_MATCH' });
	});
});

describe('SEARCH_SIMILARITY_THRESHOLD', () => {
	it('is loose enough to be a suggestion and tight enough to mean something', () => {
		expect(SEARCH_SIMILARITY_THRESHOLD).toBeGreaterThan(0.7);
		expect(SEARCH_SIMILARITY_THRESHOLD).toBeLessThan(0.92);
	});
});

describe('expandSearch — a coincidental substring must not suppress the fold', () => {
	/**
	 * The live bug this covers: `Chn` returned exactly one row — an unrelated *email*
	 * containing "chn" — and a zero-only trigger let that single coincidence disable
	 * the whole feature, hiding `Zhizhen Chen` at a .933 match.
	 */
	const roster = ['Sarah Gulati', 'Harsh Vayani', 'Zhizhen Chen', 'Maria Rodriguez'];

	it('folds anyway when the exact search returns only a handful', async () => {
		const { prisma, calls } = fakePrisma(roster, 1);
		const expansion = await expandSearch(prisma, 'Chn');

		expect(calls.findMany).toBe(1);
		expect(expansion.names).toEqual(['Zhizhen Chen']);
	});

	it.each([0, 1, EXACT_MATCH_FLOOR - 1])('folds at %i exact hits', async (exact) => {
		const { prisma } = fakePrisma(roster, exact);
		expect((await expandSearch(prisma, 'Chn')).fuzzy).toBe(true);
	});

	it('preserves the fast path once the term is productive', async () => {
		// At or above the floor the query is clearly finding people, so the scan is
		// skipped entirely and the results are exactly what was typed for.
		const { prisma, calls } = fakePrisma(roster, EXACT_MATCH_FLOOR);
		expect(await expandSearch(prisma, 'Chn')).toEqual({
			...NO_EXPANSION,
			exact: EXACT_MATCH_FLOOR
		});
		expect(calls.findMany).toBe(0);
	});

	it('unions the fuzzy names with the exact hits rather than replacing them', async () => {
		// The predicate keeps both substring clauses AND the resolved names, so the one
		// row that matched exactly is still selected alongside the close matches.
		const { where } = await resolveRecipientWhere(fakePrisma(roster, 1).prisma, {
			search: 'Chn'
		});
		expect(conditions(where)).toEqual([
			{
				OR: [
					{ name: { contains: 'Chn', mode: 'insensitive' } },
					{ email: { contains: 'Chn', mode: 'insensitive' } },
					{ name: { in: ['Zhizhen Chen'] } }
				]
			}
		]);
	});
});

describe('expandSearch — the probe is scoped to the caller’s own filters', () => {
	/**
	 * The live bug: `adm` cleared the floor on five `admin*@yopmail.com` addresses plus a
	 * few undeclared accounts, none of them applicants, so the Admissions queue rendered
	 * "No applicants found" with the fold suppressed instead of offering `Adam Hmaidan`.
	 * A term is only productive if it is productive for the list being shown.
	 */
	const roster = ['Adam Hmaidan', 'Jay Hmaidan', 'Vibha K'];

	it('counts inside the caller’s conditions rather than across the whole table', async () => {
		const { prisma, calls } = fakePrisma(roster, 0);
		const scope = [{ role: { in: [Role.HACKER] } }, { activeDecision: null }];

		await expandSearch(prisma, 'adm', scope);

		expect(calls.probeWhere).toEqual({
			AND: [
				...scope,
				{
					OR: [
						{ name: { contains: 'adm', mode: 'insensitive' } },
						{ email: { contains: 'adm', mode: 'insensitive' } }
					]
				}
			]
		});
	});

	it('restricts candidate names before ranking and applying the suggestion cap', async () => {
		const { prisma, calls } = fakePrisma(roster, 0);
		const scope = [{ role: { in: [Role.HACKER] } }, { activeDecision: null }];

		await expandSearch(prisma, 'adm', scope);

		expect(calls.candidateWhere).toEqual({ AND: scope });
	});

	it('folds when the term only clears the floor outside the caller’s scope', async () => {
		// The stand-in answers the *scoped* probe — 0 in-scope hits — where the global
		// count would have been 8. The fold is what surfaces `Adam Hmaidan`.
		const { prisma } = fakePrisma(roster, 0);
		const expansion = await expandSearch(prisma, 'adm', [{ role: { in: [Role.HACKER] } }]);
		expect(expansion.fuzzy).toBe(true);
		expect(expansion.names).toContain('Adam Hmaidan');
	});

	it('still skips the fold when the term is productive within that scope', async () => {
		// The floor was never the problem, so a genuinely productive term is untouched.
		const { prisma, calls } = fakePrisma(roster, EXACT_MATCH_FLOOR);
		expect(await expandSearch(prisma, 'adm', [{ role: { in: [Role.HACKER] } }])).toEqual({
			...NO_EXPANSION,
			exact: EXACT_MATCH_FLOOR
		});
		expect(calls.findMany).toBe(0);
	});

	it('probes with the same non-search conditions it then selects with', async () => {
		// The circularity the split exists to avoid: the search clause is built FROM the
		// expansion, so it cannot be part of the scope the probe decides the expansion in.
		const { prisma, calls } = fakePrisma(roster, 0);
		const filters = { search: 'adm', roles: [Role.HACKER], universities: ['Rice'] };

		const { where } = await resolveRecipientWhere(prisma, filters);

		const probe = (calls.probeWhere as { AND: unknown[] }).AND;
		const selected = conditions(where);
		// Everything but the trailing search clause is shared, verbatim.
		expect(probe.slice(0, -1)).toEqual(selected.slice(0, -1));
		expect(recipientConditions(filters)).toEqual(probe.slice(0, -1));
		expect(selected.at(-1)).toHaveProperty('OR');
	});

	it('leaves an unfiltered caller probing the whole table, as before', async () => {
		const { prisma, calls } = fakePrisma(roster, 0);
		await resolveRecipientWhere(prisma, { search: 'adm' });
		expect(calls.probeWhere).toEqual({
			AND: [
				{
					OR: [
						{ name: { contains: 'adm', mode: 'insensitive' } },
						{ email: { contains: 'adm', mode: 'insensitive' } }
					]
				}
			]
		});
	});
});

describe('expandSearch — suggestions never repeat what the search already found', () => {
	/**
	 * The strip captions itself off this. `fuzzy` alone said "the fold ran", and because
	 * the fold runs below a floor of five rather than at zero it runs constantly over
	 * rows that DID match — so `Vayani` on a twelve-person Admissions queue rendered
	 * "No exact match — did you mean:" above three people named Vayani.
	 */
	const vayanis = ['Ali Vayani', 'Alisha Vayani', 'Brandon Vayani'];

	it('drops candidates the substring clause already selected', async () => {
		// Every one of these contains the term, so every row carrying them is in the
		// result set before the suggestion list is consulted. Offering them back widens
		// nothing — the list empties and the strip has nothing to render.
		const { prisma } = fakePrisma(vayanis, 3);
		expect((await expandSearch(prisma, 'Vayani')).names).toEqual([]);
	});

	it('cannot change the result set by doing so', async () => {
		// The safety argument in one assertion: with no names to OR in, the predicate is
		// exactly the predicate an unexpanded search would have produced.
		const { where } = await resolveRecipientWhere(fakePrisma(vayanis, 3).prisma, {
			search: 'Vayani'
		});
		expect(where).toEqual(buildRecipientWhere({ search: 'Vayani' }));
	});

	it('still offers the names that genuinely widen the search', async () => {
		// `Vibha K` does not contain `iha`, so it is a real suggestion; `vibhak` — which
		// the substring clause already reaches — is not offered alongside it.
		const { prisma } = fakePrisma(['Vibha K', 'Ruihan Ma'], 1);
		const expansion = await expandSearch(prisma, 'iha');
		expect(expansion.names).toContain('Vibha K');
		expect(expansion.names).not.toContain('Ruihan Ma');
	});

	it('measures containment against the raw term, not the trimmed one', async () => {
		// `searchCondition` puts the caller's raw string in `contains`, so ` Vayani `
		// selects nobody and every name is still a legitimate suggestion. Trimming here
		// would drop names the predicate never matched, which WOULD change the result set.
		const { prisma } = fakePrisma(vayanis, 0);
		expect((await expandSearch(prisma, ' Vayani ')).names).toEqual(vayanis);
	});

	it('counts the cap over the names that survive the filter', async () => {
		const crowd = Array.from({ length: MAX_FUZZY_NAMES + 5 }, (_, i) => `Sarah Chen ${i}`);
		// All of them contain `Chen`, so nothing survives and nothing is truncated.
		expect((await expandSearch(fakePrisma(crowd, 0).prisma, 'Chen')).capped).toBe(false);
		// None of them contain `Chn`, so the cap applies as before.
		expect((await expandSearch(fakePrisma(crowd, 0).prisma, 'Sarh Chn')).capped).toBe(true);
	});
});

describe('expandSearch — the exact count it reports', () => {
	const roster = ['Ali Vayani', 'Zhizhen Chen'];

	it('is the scoped count, so the caller can caption the strip honestly', async () => {
		const { prisma } = fakePrisma(roster, 3);
		expect((await expandSearch(prisma, 'Vayan')).exact).toBe(3);
	});

	it('is reported on the fast path too, where the fold never ran', async () => {
		const { prisma } = fakePrisma(roster, EXACT_MATCH_FLOOR + 2);
		expect(await expandSearch(prisma, 'Chen')).toEqual({
			...NO_EXPANSION,
			exact: EXACT_MATCH_FLOOR + 2
		});
	});

	it('is zero when nothing matched, which is the "no exact match" case', async () => {
		const { prisma } = fakePrisma(roster, 0);
		expect((await expandSearch(prisma, 'Chn')).exact).toBe(0);
	});

	it('is zero when there was no term to match with', async () => {
		expect(NO_EXPANSION.exact).toBe(0);
		expect((await expandSearch(fakePrisma(roster, 9).prisma, undefined)).exact).toBe(0);
	});
});

describe('recipientConditions', () => {
	it('is buildRecipientWhere without the search clause', () => {
		const filters = { search: 'ada', roles: [Role.HACKER], statuses: [UserStatus.APPLIED] };
		expect(recipientConditions(filters)).toEqual(
			conditions(buildRecipientWhere(filters)).filter((c) => !('OR' in c))
		);
	});

	it('is empty for a search-only filter, so the probe scope is the whole table', () => {
		expect(recipientConditions({ search: 'ada' })).toEqual([]);
		expect(whereFromConditions([])).toEqual({});
	});
});

describe('expandSearch — multi-token relevance', () => {
	const roster = ['Sarah Gulati', 'Harsh Vayani', 'Zhizhen Chen', 'Maria Rodriguez'];

	it('reaches a name on its second token, which whole-query scoring missed', async () => {
		// `Sarh Chn` used to surface only anagrams of its FIRST token and no Chen at all.
		const { prisma } = fakePrisma(roster, 0);
		expect((await expandSearch(prisma, 'Sarh Chn')).names).toContain('Zhizhen Chen');
	});

	it('ranks a name matching both tokens above one matching either', async () => {
		const { prisma } = fakePrisma(['Sarah Gulati', 'Zhizhen Chen', 'Sarah Chen'], 0);
		expect((await expandSearch(prisma, 'Sarh Chn')).names[0]).toBe('Sarah Chen');
	});

	it('orders the surviving partial matches by mean relevance', async () => {
		// Sarah .713 before Chen .699 — both are honest matches on one token each, and
		// this ordering is the only relevance signal the paginated table cannot carry.
		const { prisma } = fakePrisma(roster, 0);
		expect((await expandSearch(prisma, 'Sarh Chn')).names).toEqual([
			'Sarah Gulati',
			'Zhizhen Chen'
		]);
	});

	it('keeps a single-token query behaving exactly as before', async () => {
		const { prisma } = fakePrisma(roster, 0);
		expect((await expandSearch(prisma, 'Sarh')).names).toEqual(['Sarah Gulati']);
	});
});
