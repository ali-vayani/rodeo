import { z } from 'zod';
import type { Prisma, PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus, QuestionType } from '$lib/generated/prisma/client';
import { USER_LINKED_FIELD_COLUMN, type LinkedField } from '$lib/linkedFields';
import { splitNoValue } from '$lib/facets';
import { encodeMultiSelectMember } from '$lib/questions/multiSelect';
import { stateCondition } from '$lib/server/homeState';
import { tokenMatch, normalizeName } from '$lib/text/similarity';
import { isValidEmail } from '$lib/email/address';

/**
 * Filters over the `User` columns an application question writes through to. Shared
 * with `admissions.list`, which keeps its own predicate but must read these keys
 * identically. `[]` selects nobody; absent means no filter.
 */
export const linkedFieldFilterSchema = z.object({
	names: z.array(z.string()).optional(),
	universities: z.array(z.string()).optional(),
	years: z.array(z.string()).optional()
});

export type LinkedFieldFilters = z.infer<typeof linkedFieldFilterSchema>;

/**
 * Filters over answers stored in `ApplicationResponse` rather than a `User` column.
 *
 * Separate keys rather than a discriminated union, so a filter saved against a question
 * whose type later changed stops applying instead of failing to parse.
 */
const answerFilter = z.object({
	questionId: z.string().min(1),
	/** Exact membership. `[]` selects nobody. */
	values: z.array(z.string()).optional(),
	/** Case-insensitive substring, for a short-text question. */
	contains: z.string().optional(),
	/** Inclusive numeric bounds, for a NUMBER question. Either end may be omitted. */
	min: z.number().optional(),
	max: z.number().optional()
});

export const answerFilterSchema = z.object({
	// Bounded because each entry is a separate correlated subquery.
	answers: z.array(answerFilter).max(50).optional(),
	states: z.array(z.string()).max(80).optional()
});

export type AnswerFilters = z.infer<typeof answerFilterSchema>;

/** Filter key ↔ linked field. The plural is the wire name and the query parameter. */
const LINKED_FILTER_KEYS: Record<
	keyof LinkedFieldFilters,
	Exclude<LinkedField, 'DIETARY_RESTRICTION'>
> = {
	names: 'NAME',
	universities: 'UNIVERSITY',
	years: 'YEAR'
};

/**
 * The linked columns that are nullable. Prisma rejects `{ name: null }` at runtime, so
 * "no value" means NULL-or-empty for these two and empty-only for `name`.
 */
const NULLABLE_LINKED_FIELDS = new Set<Exclude<LinkedField, 'DIETARY_RESTRICTION'>>([
	'UNIVERSITY',
	'YEAR'
]);

/**
 * The one definition of "which users does this filter select". Browse and send MUST
 * share it, or a UI showing "0 recipients" could mail the entire database.
 */
export const recipientFilterSchema = z.object({
	search: z.string().optional(),
	roles: z.array(z.nativeEnum(Role)).optional(),
	statuses: z.array(z.nativeEnum(UserStatus)).optional(),
	decisions: z.array(z.nativeEnum(DecisionStatus)).optional(),
	includeNoDecision: z.boolean().optional(),
	pendingDecisions: z.array(z.nativeEnum(DecisionStatus)).optional(),
	includeNoPending: z.boolean().optional(),
	/** Explicit recipient list, intersected with any other filters. `[]` means nobody. */
	emails: z.array(z.string()).optional(),
	...linkedFieldFilterSchema.shape,
	...answerFilterSchema.shape
});

export type RecipientFilters = z.infer<typeof recipientFilterSchema>;

// Email-list parsing lives in $lib/admin/filters.ts — it must be importable from
// the browser, and everything under $lib/server is barred from client bundles.

/**
 * Forces a match-nothing predicate, for a filter engaged with none of its options
 * selected. Applies to the address list, the linked fields and the decision pair;
 * `roles: []` and `statuses: []` never reach here, so their `[]` matches everyone.
 */
const MATCH_NOTHING = 'IMPOSSIBLE_NO_MATCH';

/** Marks an `EmailLog.userIds` entry that is an address rather than a uid, since an
    external recipient has no uid. A cuid can never contain a colon. */
export const EXTERNAL_RECIPIENT_PREFIX = 'external:';

/** Same normalisation `buildRecipientWhere` applies, so lookups and sends agree. */
function normalize(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Splits an explicit address list into the addresses no User row claims.
 *
 * Preview and send MUST share this, so the count the admin confirms matches what the
 * send is bound to. Addresses already belonging to a user are dropped so they are
 * mailed once as that user; malformed entries land in `invalid`.
 */
export function splitExplicitEmails(
	emails: readonly string[] | undefined,
	matched: readonly { email: string }[]
): { external: string[]; invalid: string[] } {
	if (!emails?.length) return { external: [], invalid: [] };

	const found = new Set(matched.map((u) => normalize(u.email)));
	const seen = new Set<string>();
	const external: string[] = [];
	const invalid: string[] = [];

	for (const raw of emails) {
		const email = normalize(raw);
		if (!email || found.has(email) || seen.has(email)) continue;
		seen.add(email);
		if (isValidEmail(email)) external.push(email);
		else invalid.push(email);
	}

	return { external, invalid };
}

/**
 * Jaro-Winkler score at or above which a stored name is offered as a search match.
 *
 * Well below the blacklist's 0.92, because a blacklist hit accuses someone while a
 * search hit merely puts an extra row on screen. Catches chn/chen (.933) and
 * mohamed/mohammed (.975); rejects chen/rodriguez and sara/martinez.
 */
export const SEARCH_SIMILARITY_THRESHOLD = 0.8;

/** Cap on the `IN (...)` list of fuzzy names — past this the result is noise. */
export const MAX_FUZZY_NAMES = 25;

/**
 * Concrete `name` values to widen a search with. Resolved to explicit strings so the
 * predicate stays exact: a similarity score is not something a WHERE clause can
 * express, and preview and send must select the same people.
 */
export interface SearchExpansion {
	/**
	 * Extra names ORed into the search clause, most relevant first. This ordering is
	 * the only relevance signal available, since the rows come back `createdAt desc`
	 * under pagination. Only ever names the substring clause did not already select.
	 */
	names: string[];
	/** Whether the fold ran, i.e. the term returned fewer than `EXACT_MATCH_FLOOR` rows. */
	fuzzy: boolean;
	/** More names cleared the threshold than `MAX_FUZZY_NAMES` — the list is truncated. */
	capped: boolean;
	/**
	 * How many rows the typed term matched exactly, within the caller's own scope.
	 *
	 * What a suggestion strip should caption itself from. `fuzzy` only says the fold
	 * ran, and it runs below a floor of five, so keying wording off it prints "No
	 * exact match" above three exact matches.
	 */
	exact: number;
}

/** No widening: what a caller passes when it has no search term. */
export const NO_EXPANSION: SearchExpansion = { names: [], fuzzy: false, capped: false, exact: 0 };

/** The exact half of the search predicate — substring, case-insensitive, name or email. */
function exactSearchOr(search: string): Prisma.UserWhereInput[] {
	return [
		{ name: { contains: search, mode: 'insensitive' as const } },
		{ email: { contains: search, mode: 'insensitive' as const } }
	];
}

/** The search clause, shared verbatim by `buildRecipientWhere` and `admissions.list`. */
export function searchCondition(
	search: string | undefined,
	expansion: SearchExpansion = NO_EXPANSION
): Prisma.UserWhereInput | null {
	if (!search) return null;
	const or = exactSearchOr(search);
	if (expansion.names.length) or.push({ name: { in: expansion.names } });
	return { OR: or };
}

/**
 * Exact-hit count at or above which the fuzzy fold is skipped. Not zero: the substring
 * runs over name *and email*, so a short query lands on somebody's address by
 * coincidence often enough that one such hit would suppress the feature.
 */
export const EXACT_MATCH_FLOOR = 5;

/**
 * Resolve a search term into extra names to widen it with.
 *
 * Exact-first, fuzzy-as-a-supplement: a query that already returns a real result set
 * skips the fold, and otherwise close matches are unioned in rather than substituted.
 * The fold happens in memory because similarity is not expressible as a WHERE clause,
 * and scans `distinct` names, so it is bounded by people rather than rows.
 *
 * Candidates qualify on `best` and are ranked by `score`; thresholding on the mean
 * would make multi-token queries unsatisfiable.
 *
 * `scope` is the caller's own conditions with the search clause left out, since that
 * clause is built from the expansion this computes. Probing globally is a bug: a term
 * productive across the whole table can be unproductive for the list being shown.
 */
export async function expandSearch(
	prisma: Pick<PrismaClient, 'user'>,
	search: string | undefined,
	scope: readonly Prisma.UserWhereInput[] = []
): Promise<SearchExpansion> {
	const term = search?.trim();
	// `search` rather than `term` in the guard so TypeScript narrows it below — the
	// containment test has to measure against the caller's raw string, not the trimmed one.
	if (!search || !term) return NO_EXPANSION;

	const exact = await prisma.user.count({
		where: whereFromConditions([...scope, { OR: exactSearchOr(term) }])
	});
	if (exact >= EXACT_MATCH_FLOOR) return { ...NO_EXPANSION, exact };

	const query = normalizeName(term);
	if (!query) return { ...NO_EXPANSION, exact };

	// One `SELECT DISTINCT name` then a Jaro-Winkler pass in memory: ~3ms of SQL and ~2ms
	// of scoring at 1,865 users, both linear in the distinct-name count. If this ever shows
	// up in a profile, hand `scope` to this query too or reach for a trigram index.
	const rows = await prisma.user.findMany({ select: { name: true }, distinct: ['name'] });

	// Measured against the caller's raw term because that is the string
	// `searchCondition` puts in `contains`.
	const alreadyExact = search.toLowerCase();

	const scored: { name: string; score: number }[] = [];
	for (const { name } of rows) {
		// A name the substring clause already selects cannot widen anything — every row
		// carrying it is in the result set before this list is consulted.
		if (name.toLowerCase().includes(alreadyExact)) continue;
		const { score, best } = tokenMatch(query, normalizeName(name));
		if (best >= SEARCH_SIMILARITY_THRESHOLD) scored.push({ name, score });
	}
	scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

	return {
		names: scored.slice(0, MAX_FUZZY_NAMES).map((s) => s.name),
		fuzzy: true,
		capped: scored.length > MAX_FUZZY_NAMES,
		exact
	};
}

/**
 * One AND condition per engaged linked-field filter: absent means no condition, `[]`
 * means match nothing, and the `NO_VALUE` sentinel ORs in the absent case alongside
 * real values.
 *
 * Exact `IN (...)` throughout — fuzziness belongs in `expandSearch`.
 */
export function linkedFieldConditions(filters: LinkedFieldFilters): Prisma.UserWhereInput[] {
	const conditions: Prisma.UserWhereInput[] = [];

	for (const [key, field] of Object.entries(LINKED_FILTER_KEYS) as [
		keyof LinkedFieldFilters,
		Exclude<LinkedField, 'DIETARY_RESTRICTION'>
	][]) {
		const selected = filters[key];
		if (selected === undefined) continue;
		if (selected.length === 0) {
			conditions.push({ uid: MATCH_NOTHING });
			continue;
		}

		const { values, includeNone } = splitNoValue(selected);
		const or: Prisma.UserWhereInput[] = [];
		// Computed keys over a closed set of column names — the cast is what a dynamic
		// key costs; `LINKED_FIELD_COLUMN` is what keeps the set closed.
		const column = USER_LINKED_FIELD_COLUMN[field];
		if (values.length) or.push({ [column]: { in: values } } as Prisma.UserWhereInput);
		if (includeNone) {
			// The write-through does not trim, so a blank answer stores '' rather than
			// leaving the column NULL. Both spellings of "absent" have to be selected.
			if (NULLABLE_LINKED_FIELDS.has(field)) {
				or.push({ [column]: null } as Prisma.UserWhereInput);
			}
			or.push({ [column]: '' } as Prisma.UserWhereInput);
		}

		conditions.push(or.length === 1 ? or[0] : { OR: or });
	}

	return conditions;
}

/**
 * Selects users who did not answer a question: no response row, or one holding a
 * blank. Both occur, since a question added later leaves no row while a field opened
 * and cleared leaves an empty one.
 */
function unansweredConditions(questionId: string): Prisma.UserWhereInput[] {
	return [
		{ application: { none: { questionId } } },
		{ application: { some: { questionId, value: '' } } }
	];
}

/** Users holding one of `values` for `questionId`. */
function answeredWith(questionId: string, values: string[]): Prisma.UserWhereInput {
	return { application: { some: { questionId, value: { in: values } } } };
}

/**
 * Users whose MULTI_SELECT answer contains any of `values`.
 *
 * A substring match, because the chosen options live inside one `text` column that
 * Postgres cannot index into. `encodeMultiSelectMember` quotes the option, so "Go"
 * cannot match the answer `["Golang"]`. Case-sensitive on purpose: these are the exact
 * strings the question offered, not a search box.
 */
function answerContainsAny(questionId: string, values: string[]): Prisma.UserWhereInput {
	return {
		application: {
			some: {
				questionId,
				OR: values.map((value) => ({ value: { contains: encodeMultiSelectMember(value) } }))
			}
		}
	};
}

/**
 * Which of `questionIds` store a set rather than a single answer.
 *
 * Looked up rather than inferred, so single-select filtering stays the indexed `IN` it
 * has always been: a predicate that handled both shapes would substring-match every
 * plain answer too, which is a laxer question than the organizer asked.
 */
async function multiSelectQuestions(
	prisma: Pick<PrismaClient, 'question'>,
	questionIds: string[]
): Promise<Set<string>> {
	const rows = await prisma.question.findMany({
		where: { id: { in: questionIds }, type: QuestionType.MULTI_SELECT },
		select: { id: true }
	});
	return new Set(rows.map((row) => row.id));
}

/**
 * The distinct answers to a NUMBER question that fall inside a range.
 *
 * Answers are stored as text, so `value >= 18` would be a string comparison in which
 * "9" beats "18". Resolving the range to explicit values keeps the predicate an exact
 * `IN (...)`. Affordable because the list is distinct answers, not rows.
 */
async function numericMatches(
	prisma: Pick<PrismaClient, 'applicationResponse'>,
	questionId: string,
	min: number | undefined,
	max: number | undefined
): Promise<string[]> {
	const rows = await prisma.applicationResponse.groupBy({
		by: ['value'],
		where: { questionId }
	});

	const matches: string[] = [];
	for (const { value } of rows) {
		const n = Number(value);
		if (value === '' || !Number.isFinite(n)) continue;
		if (min !== undefined && n < min) continue;
		if (max !== undefined && n > max) continue;
		matches.push(value);
	}
	return matches;
}

/**
 * One AND condition per engaged answer filter, plus the state filter. Async because
 * numeric ranges and states resolve to explicit values first. An entry with none of
 * `values`/`contains`/`min`/`max` set is an open facet, not a selection, so it is
 * skipped.
 */
export async function resolveAnswerConditions(
	prisma: Pick<PrismaClient, 'user' | 'applicationResponse' | 'settings' | 'question'>,
	filters: AnswerFilters
): Promise<Prisma.UserWhereInput[]> {
	const conditions: Prisma.UserWhereInput[] = [];
	const entries = filters.answers ?? [];

	// One read for the whole panel, and only when something is actually selected — the
	// range and substring paths don't care what shape the answer is stored in.
	const withValues = entries
		.filter((entry) => entry.values?.length)
		.map((entry) => entry.questionId);
	const multiSelect = withValues.length
		? await multiSelectQuestions(prisma, withValues)
		: new Set<string>();

	for (const entry of entries) {
		const { questionId, values, contains, min, max } = entry;

		if (values !== undefined) {
			if (values.length === 0) {
				conditions.push({ uid: MATCH_NOTHING });
			} else {
				const { values: real, includeNone } = splitNoValue(values);
				const or: Prisma.UserWhereInput[] = [];
				if (real.length) {
					or.push(
						multiSelect.has(questionId)
							? answerContainsAny(questionId, real)
							: answeredWith(questionId, real)
					);
				}
				if (includeNone) or.push(...unansweredConditions(questionId));
				conditions.push(or.length === 1 ? or[0] : { OR: or });
			}
		}

		const term = contains?.trim();
		if (term) {
			conditions.push({
				application: { some: { questionId, value: { contains: term, mode: 'insensitive' } } }
			});
		}

		if (min !== undefined || max !== undefined) {
			const matches = await numericMatches(prisma, questionId, min, max);
			// No answer satisfies the range. Still a narrowing selection, so it matches
			// nobody rather than dropping out and matching everybody.
			conditions.push(matches.length ? answeredWith(questionId, matches) : { uid: MATCH_NOTHING });
		}
	}

	if (filters.states !== undefined) {
		if (filters.states.length === 0) {
			conditions.push({ uid: MATCH_NOTHING });
		} else {
			// Read only when the filter is engaged, so every other request avoids the lookup.
			const settings = await prisma.settings.findFirst({ select: { homeState: true } });
			const condition = await stateCondition(prisma, filters.states, settings?.homeState ?? null);
			if (condition) conditions.push(condition);
		}
	}

	return conditions;
}

/**
 * One AND condition list, or match-everyone when empty. The "no filter keys supplied"
 * case matches the whole database, so it is spelled once here rather than at each
 * caller.
 */
export function whereFromConditions(
	conditions: readonly Prisma.UserWhereInput[]
): Prisma.UserWhereInput {
	return conditions.length > 0 ? { AND: [...conditions] } : {};
}

/**
 * The recipient predicate's conditions without the search clause. Split out because
 * `expandSearch` probes inside the caller's scope, and the search clause is built from
 * the expansion that probe decides.
 */
export function recipientConditions(filters: RecipientFilters): Prisma.UserWhereInput[] {
	const {
		roles,
		statuses,
		decisions,
		includeNoDecision,
		pendingDecisions,
		includeNoPending,
		emails
	} = filters;

	const conditions: Prisma.UserWhereInput[] = [];

	// Lowercased to match stored addresses, which are written lowercase everywhere.
	if (emails !== undefined) {
		conditions.push(
			emails.length
				? { email: { in: emails.map((e) => e.trim().toLowerCase()) } }
				: { uid: MATCH_NOTHING }
		);
	}

	// `in`, not `hasSome`: `roles` is the set the admin ticked, but each user holds
	// exactly one — so the predicate is membership rather than array overlap.
	if (roles?.length) conditions.push({ role: { in: roles } });
	if (statuses?.length) conditions.push({ status: { in: statuses } });

	// Reads activeDecision — never pendingDecision, which has its own filter below so a
	// send to "accepted" can never quietly include people who haven't been told yet.
	if (decisions !== undefined || includeNoDecision !== undefined) {
		const decisionOr: Prisma.UserWhereInput[] = [];
		if (decisions?.length) decisionOr.push({ activeDecision: { in: decisions } });
		if (includeNoDecision) decisionOr.push({ activeDecision: null });

		if (decisionOr.length === 1) conditions.push(decisionOr[0]);
		else if (decisionOr.length > 1) conditions.push({ OR: decisionOr });
		else conditions.push({ uid: MATCH_NOTHING });
	}

	// A literal PENDING reads as "none": it is the enum's starting value and
	// `setDecision` refuses to write it.
	if (pendingDecisions !== undefined || includeNoPending !== undefined) {
		const pendingOr: Prisma.UserWhereInput[] = [];
		if (pendingDecisions?.length) pendingOr.push({ pendingDecision: { in: pendingDecisions } });
		if (includeNoPending) {
			pendingOr.push({ pendingDecision: null }, { pendingDecision: DecisionStatus.PENDING });
		}

		if (pendingOr.length === 1) conditions.push(pendingOr[0]);
		else if (pendingOr.length > 1) conditions.push({ OR: pendingOr });
		else conditions.push({ uid: MATCH_NOTHING });
	}

	conditions.push(...linkedFieldConditions(filters));

	return conditions;
}

/**
 * The full recipient predicate: the caller's conditions plus the resolved search clause.
 *
 * No filter keys at all means match everyone, so callers that send must gate on the
 * count. Covers only the keys expressible without a query; `answers` and `states` come
 * from `resolveAnswerConditions`. `resolveRecipientWhere` is the real entry point.
 */
export function buildRecipientWhere(
	filters: RecipientFilters,
	expansion: SearchExpansion = NO_EXPANSION
): Prisma.UserWhereInput {
	const conditions = recipientConditions(filters);
	const searchClause = searchCondition(filters.search, expansion);
	if (searchClause) conditions.push(searchClause);
	return whereFromConditions(conditions);
}

/**
 * `buildRecipientWhere` with the search term already resolved against the database.
 *
 * The single entry point for every procedure that accepts a `search` and shares a
 * recipient set with another. The conditions are built once and used twice, as the
 * probe's scope and as the predicate, which is what keeps preview and send in step.
 */
export async function resolveRecipientWhere(
	prisma: Pick<PrismaClient, 'user' | 'applicationResponse' | 'settings' | 'question'>,
	filters: RecipientFilters
): Promise<{ where: Prisma.UserWhereInput; expansion: SearchExpansion }> {
	// The answer conditions are part of the scope the search probe counts inside, not
	// an afterthought appended to the finished predicate.
	const conditions = [
		...recipientConditions(filters),
		...(await resolveAnswerConditions(prisma, filters))
	];
	const expansion = await expandSearch(prisma, filters.search, conditions);
	const searchClause = searchCondition(filters.search, expansion);
	return {
		where: whereFromConditions(searchClause ? [...conditions, searchClause] : conditions),
		expansion
	};
}
