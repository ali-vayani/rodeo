import { z } from 'zod';
import type { Prisma, PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';
import { splitNoValue, type LinkedUserField } from '$lib/linkedFields';
import { tokenMatch, normalizeName } from '$lib/text/similarity';

/**
 * Filters over the `User` columns an application question writes through to.
 *
 * Split out from `recipientFilterSchema` because `admissions.list` keeps its own
 * predicate (it matches pendingDecision OR activeDecision, which the recipient
 * predicate deliberately never does) but must accept and interpret these three keys
 * identically. One schema plus one clause-builder is what stops the two from drifting
 * a second time — they already had duplicate copies of the search clause.
 *
 * Each key follows the engaged-but-empty rule: `[]` selects nobody, absent means "no
 * filter". See `linkedFieldConditions`.
 */
export const linkedFieldFilterSchema = z.object({
	names: z.array(z.string()).optional(),
	universities: z.array(z.string()).optional(),
	years: z.array(z.string()).optional()
});

export type LinkedFieldFilters = z.infer<typeof linkedFieldFilterSchema>;

/** Filter key ↔ `User` column. The plural is the wire name; the singular is the column. */
const LINKED_FILTER_KEYS: Record<keyof LinkedFieldFilters, LinkedUserField> = {
	names: 'name',
	universities: 'university',
	years: 'year'
};

/**
 * The linked columns that are nullable in `prisma/schema.prisma`.
 *
 * `User.name` is `String` (NOT NULL) while `university` and `year` are `String?`, and
 * Prisma rejects `{ name: null }` at runtime rather than treating it as a never-true
 * filter. So "no value" means NULL-or-empty for two of the three columns and
 * empty-only for `name` — which is exactly right anyway, since a NULL name cannot
 * exist for the facet count to have found one.
 */
const NULLABLE_LINKED_FIELDS = new Set<LinkedUserField>(['university', 'year']);

/**
 * The one definition of "which users does this filter select".
 *
 * `user.list` (browse) and `email.sendCustom` / `email.previewRecipients` (send)
 * MUST share this. They previously disagreed on the empty-selection case in the
 * worst possible direction: the browse query matched nothing while the send query
 * dropped the clause and matched everyone, so a UI showing "0 recipients" from one
 * would mail the entire database via the other.
 */
export const recipientFilterSchema = z.object({
	search: z.string().optional(),
	roles: z.array(z.nativeEnum(Role)).optional(),
	statuses: z.array(z.nativeEnum(UserStatus)).optional(),
	decisions: z.array(z.nativeEnum(DecisionStatus)).optional(),
	includeNoDecision: z.boolean().optional(),
	/**
	 * Explicit recipient list. Present means "these addresses", intersected with any
	 * other filters supplied. An empty array means nobody — same "engaged but empty"
	 * rule the decision filter uses.
	 */
	emails: z.array(z.string()).optional(),
	...linkedFieldFilterSchema.shape
});

export type RecipientFilters = z.infer<typeof recipientFilterSchema>;

// Email-list parsing lives in $lib/admin/filters.ts — it must be importable from
// the browser, and everything under $lib/server is barred from client bundles.

/**
 * Forces a match-nothing predicate. Used when the caller explicitly engaged the
 * decision filter but selected none of its options — "show nothing", not "show all".
 */
const MATCH_NOTHING = 'IMPOSSIBLE_NO_MATCH';

/**
 * Marks an `EmailLog.userIds` entry that is an address rather than a uid.
 *
 * `userIds` is the record of who a send reached, and an external recipient has no
 * uid to put there. Dropping them would make the row understate its own blast radius
 * — the one thing that record exists to state — so they go in prefixed. A uid is a
 * cuid, which can never contain a colon, so the two are unambiguous, and
 * `SendHistory` (which only counts the array) stays correct.
 */
export const EXTERNAL_RECIPIENT_PREFIX = 'external:';

/**
 * Server-side address validation for the external-send path.
 *
 * The client filters malformed entries out of the textarea before they are sent, but
 * with the external toggle on this list becomes envelope addresses rather than a
 * lookup key — so it is re-checked here rather than trusted.
 */
const externalEmailSchema = z.string().email();

/** Same normalisation `buildRecipientWhere` applies, so lookups and sends agree. */
function normalize(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Splits an explicit address list into the addresses no User row claims.
 *
 * `email.previewRecipients` and `email.sendCustom` MUST share this, for exactly the
 * reason they share `buildRecipientWhere`: the count the admin confirms is what the
 * send is bound to, so both sides have to derive the external set identically or the
 * drift check fires on a set that never changed.
 *
 * Addresses already belonging to a user are dropped — a pasted address that matches a
 * hacker is mailed once, as that hacker, so `{{name}}` still personalises. Malformed
 * entries land in `invalid` rather than being silently mailed or silently dropped.
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
		if (externalEmailSchema.safeParse(email).success) external.push(email);
		else invalid.push(email);
	}

	return { external, invalid };
}

/**
 * Jaro-Winkler score at or above which a stored name is offered as a match for a typed
 * search term.
 *
 * Deliberately far below the blacklist's 0.92, and for a reason that is about
 * consequences rather than strings: a blacklist hit accuses someone, so it is tuned to
 * reject `patel`/`patil`; a search hit merely puts an extra row on screen next to the
 * rows the admin was already going to see. Over-matching here costs a glance,
 * under-matching costs the feature — an organizer who types `Sara Chn` and gets "no
 * results" concludes the person isn't in the system.
 *
 *   catches at .80  sarh/sarah .953  chn/chen .933  mohamed/mohammed .975
 *                   jonhson/johnson .962  patel/patil .907 (fine here — a suggestion)
 *   still rejects   chen/rodriguez .00  sara/martinez .58  ada/lovelace .49
 *
 * It only ever runs as a fallback (see `expandSearch`), so a term that matches anything
 * exactly never reaches this bar at all.
 */
export const SEARCH_SIMILARITY_THRESHOLD = 0.8;

/**
 * Most fuzzy names folded into one predicate.
 *
 * A bound on the `IN (...)` list, not on the scan — the fold itself is over every
 * distinct name either way. 25 is generous for "did you mean", and past it the result
 * is noise rather than a suggestion.
 */
export const MAX_FUZZY_NAMES = 25;

/**
 * Concrete `name` values to widen a search with, plus how they were arrived at.
 *
 * The values are resolved to explicit strings on purpose. `previewRecipients` and
 * `sendCustom` must select the same people from the same input or the `expectedCount`
 * drift check fires, and a similarity score is not something a WHERE clause can
 * express — so the fuzziness is collapsed to a list of names *before* it reaches the
 * predicate, and the predicate stays exact.
 */
export interface SearchExpansion {
	/**
	 * Extra names ORed into the search clause, **most relevant first**.
	 *
	 * This ordering is the only relevance signal the feature can offer. The rows
	 * themselves come back `orderBy: createdAt desc` because they are paginated, and
	 * a score computed in application memory cannot drive a SQL `ORDER BY` without
	 * loading every candidate row first — so the table is honestly unranked and this
	 * list is honestly ranked. A UI should render it in the order given, not silently
	 * reorder the table to imply otherwise, and should caption it off `exact` rather
	 * than off `fuzzy`.
	 *
	 * Only ever names the substring clause did **not** already select. A name containing
	 * the typed term is in the result set regardless, so offering it back widens nothing
	 * and merely captions rows the admin can already see.
	 */
	names: string[];
	/** Whether the fold ran, i.e. the term returned fewer than `EXACT_MATCH_FLOOR` rows. */
	fuzzy: boolean;
	/** More names cleared the threshold than `MAX_FUZZY_NAMES` — the list is truncated. */
	capped: boolean;
	/**
	 * How many rows the typed term matched **exactly**, within the caller's own scope.
	 *
	 * The field the suggestion strip has to caption itself from. `fuzzy` only says the
	 * fold ran, and since the fold runs below a floor of five rather than at zero, it
	 * runs all the time over rows that *did* match — so a UI keying its wording off
	 * `fuzzy` says "No exact match" above three exact matches. Searching `Vayani` on a
	 * twelve-person Admissions queue did exactly that.
	 *
	 * Zero when there is no search term, which is also when there is nothing to caption.
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

/**
 * The search clause, shared verbatim by `buildRecipientWhere` and `admissions.list`.
 *
 * Both used to carry their own copy of this literal, which is how their predicates
 * drifted in the first place.
 */
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
 * Exact-hit count at or above which the fuzzy fold is skipped entirely.
 *
 * The fast path, and the reason it is a small number rather than zero: an exact
 * substring runs over name *and email*, so a three-letter query lands on somebody's
 * address by coincidence far more often than it finds the person meant. `Chn` returns
 * exactly one row on the dev database — an unrelated email containing "chn" — and a
 * zero-only trigger let that single coincidence suppress the whole feature, hiding
 * `Zhizhen Chen` at a .933 match.
 *
 * Five is the point where a result set stops looking like an accident. Below it the
 * fold runs and its names are added to, never substituted for, whatever matched
 * exactly; at or above it the query is clearly productive and costs one count.
 *
 * Counted *within the caller's own scope* — see `expandSearch`. The floor was never
 * the problem; a global count was.
 */
export const EXACT_MATCH_FLOOR = 5;

/**
 * Resolve a search term into extra names to widen it with.
 *
 * Exact-first, fuzzy-as-a-supplement. A query that already returns a real result set
 * skips the fold entirely, so a good query is never slowed or altered. A query that
 * returns almost nothing gets close matches **unioned in** — `searchCondition` ORs
 * these names alongside the substring clauses, so every exact hit still matches and
 * the fuzzy names are additional rows, never a replacement set.
 *
 * The fold happens in memory because similarity is not expressible as a WHERE clause;
 * `admissions.list` already does the same thing with the blacklist for the same reason.
 * The scan is over `distinct` names, so it is bounded by the number of distinct people
 * rather than the number of rows.
 *
 * Candidates qualify on `best` — one query token being a convincing typo of one name
 * token — and are *ranked* by `score`, the mean across query tokens. Thresholding on
 * the mean instead would make a two-token query unsatisfiable: `sarh chn` against
 * `Zhizhen Chen` means .69 even though `chn`/`chen` is .933, so every multi-token
 * query would return nothing. Ranking on the mean is what puts a name matching both
 * tokens above a name matching one.
 *
 * `scope` is the caller's own conditions **with the search clause left out**, and the
 * probe is counted inside it. The exclusion is not an optimisation, it is the only way
 * the question is askable: the search clause depends on the expansion this function is
 * computing, so a scope that contained it would be circular. Callers get the two halves
 * from one builder (`recipientConditions`, or `admissions.list`'s own condition list)
 * so the scope they probe with and the predicate they finally run cannot drift.
 *
 * A *global* count was the bug. `adm` matched `admin1@yopmail.com`…`admin5@…` plus a
 * few undeclared accounts — eight rows, none of them applicants — so the probe cleared
 * the floor and suppressed the fold for an Admissions queue that then rendered "No
 * applicants found" instead of offering `Adam Hmaidan`. A term is only "productive" if
 * it is productive for the list the caller is actually about to show.
 *
 * Preview/send agreement survives because it never depended on the expansion being
 * global — it depends on both procedures deriving it from the same input, which they
 * still do: `previewRecipients` and `sendCustom` build their scope from the same
 * `filters` and so compute the same probe, the same expansion, and the same set.
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

	// One `SELECT DISTINCT name` over the whole table, then a Jaro-Winkler pass in
	// memory. ~3ms of SQL and ~2ms of scoring at 1,865 users / 1,852 distinct names, and
	// both halves grow linearly with the distinct-name count — so if this ever shows up
	// in a profile at 20k applicants, the fix is to hand `scope` to this query too (it is
	// right here) or to reach for a trigram index, not to raise the floor.
	const rows = await prisma.user.findMany({ select: { name: true }, distinct: ['name'] });

	// The substring half of the predicate, measured against the caller's raw term because
	// that is the string `searchCondition` puts in `contains`. Trimming here instead would
	// let a padded term like `" ada "` drop a name the predicate never actually matched.
	const alreadyExact = search.toLowerCase();

	const scored: { name: string; score: number }[] = [];
	for (const { name } of rows) {
		// A name the substring clause already selects cannot widen anything — every row
		// carrying it is in the result set before this list is consulted. Suggesting it
		// would be the strip pointing at rows already on screen, which is how "No exact
		// match — did you mean: Ali Vayani" ended up above Ali Vayani.
		if (name.toLowerCase().includes(alreadyExact)) continue;
		const { score, best } = tokenMatch(query, normalizeName(name));
		if (best >= SEARCH_SIMILARITY_THRESHOLD) scored.push({ name, score });
	}
	// Most relevant first. The caller returns this list to the UI as the ranking the
	// paginated rows themselves cannot carry — see `SearchExpansion.names`.
	scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

	return {
		names: scored.slice(0, MAX_FUZZY_NAMES).map((s) => s.name),
		fuzzy: true,
		// Reported rather than swallowed: a truncated suggestion list is a different
		// answer from a complete one, and the caller returns this to the UI.
		capped: scored.length > MAX_FUZZY_NAMES,
		exact
	};
}

/**
 * One AND condition per engaged linked-field filter.
 *
 * The rules, identical for all three keys and identical to the decision filter's:
 *
 *   - absent          → no condition at all
 *   - `[]`            → match nothing. Engaging a filter and selecting none of its
 *                       options means "show nobody", never "show everybody". Getting
 *                       this backwards on the send path is how a UI reading "0
 *                       recipients" mails the whole database.
 *   - `[NO_VALUE, …]` → the sentinel ORs in the absent case alongside any real values.
 *
 * Exact `IN (...)` throughout. Fuzziness belongs in `expandSearch`, which resolves it
 * to explicit values before the predicate ever sees it — a predicate that scored rows
 * could not be reproduced identically by preview and send.
 */
export function linkedFieldConditions(filters: LinkedFieldFilters): Prisma.UserWhereInput[] {
	const conditions: Prisma.UserWhereInput[] = [];

	for (const [key, field] of Object.entries(LINKED_FILTER_KEYS) as [
		keyof LinkedFieldFilters,
		LinkedUserField
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
		// key costs; `LINKED_USER_FIELDS` is what keeps the set closed.
		if (values.length) or.push({ [field]: { in: values } } as Prisma.UserWhereInput);
		if (includeNone) {
			// The write-through does not trim, so a blank answer stores '' rather than
			// leaving the column NULL. Both spellings of "absent" have to be selected or
			// the "No value" option silently misses everyone who submitted a blank.
			if (NULLABLE_LINKED_FIELDS.has(field)) {
				or.push({ [field]: null } as Prisma.UserWhereInput);
			}
			or.push({ [field]: '' } as Prisma.UserWhereInput);
		}

		conditions.push(or.length === 1 ? or[0] : { OR: or });
	}

	return conditions;
}

/**
 * One AND condition list from a set of conditions, or match-everyone when there are none.
 *
 * The "no filter keys supplied at all" case is the dangerous one — it matches the whole
 * database — so it is spelled once, here, rather than at each caller.
 */
export function whereFromConditions(
	conditions: readonly Prisma.UserWhereInput[]
): Prisma.UserWhereInput {
	return conditions.length > 0 ? { AND: [...conditions] } : {};
}

/**
 * The recipient predicate's conditions **without** the search clause.
 *
 * Split out because `expandSearch` has to probe inside the caller's own scope, and the
 * search clause cannot be part of that scope: it is built *from* the expansion the probe
 * decides. Factoring it this way means the scope and the final predicate come from one
 * evaluation of the filters rather than two similar-looking ones — which is what keeps
 * `previewRecipients` and `sendCustom` counting the same rows.
 */
export function recipientConditions(filters: RecipientFilters): Prisma.UserWhereInput[] {
	const { roles, statuses, decisions, includeNoDecision, emails } = filters;

	// AND conditions so each filter stacks independently.
	const conditions: Prisma.UserWhereInput[] = [];

	// Explicit address list. Engaged-but-empty means nobody, not everybody.
	// Lowercased to match stored addresses: accounts are written lowercase everywhere,
	// so a pasted `Alice@X.com` against a stored `alice@x.com` would otherwise silently
	// match nobody — and previewRecipients would report a real user as "unknown".
	if (emails !== undefined) {
		conditions.push(
			emails.length
				? { email: { in: emails.map((e) => e.trim().toLowerCase()) } }
				: { uid: MATCH_NOTHING }
		);
	}

	// `in`, not `hasSome`: `roles` is still a list here — it is the set of roles the
	// admin ticked in the filter — but each *user* now holds exactly one, so the
	// predicate is membership rather than array overlap.
	if (roles?.length) conditions.push({ role: { in: roles } });
	if (statuses?.length) conditions.push({ status: { in: statuses } });

	// Decision filter: specific decisions AND/OR null (no decision yet).
	// Note this reads activeDecision — never pendingDecision, which is unreleased.
	if (decisions !== undefined || includeNoDecision !== undefined) {
		const decisionOr: Prisma.UserWhereInput[] = [];
		if (decisions?.length) decisionOr.push({ activeDecision: { in: decisions } });
		if (includeNoDecision) decisionOr.push({ activeDecision: null });

		if (decisionOr.length === 1) conditions.push(decisionOr[0]);
		else if (decisionOr.length > 1) conditions.push({ OR: decisionOr });
		// Engaged the filter but selected nothing → match nothing.
		else conditions.push({ uid: MATCH_NOTHING });
	}

	conditions.push(...linkedFieldConditions(filters));

	return conditions;
}

/**
 * The full recipient predicate: the caller's conditions plus the resolved search clause.
 *
 * No filter keys supplied at all → match everyone. This is the "email the whole
 * database" case, so callers that send must gate on the resulting count.
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
 * The single entry point for every procedure that both accepts a `search` and shares a
 * recipient set with another procedure. `previewRecipients` and `sendCustom` calling
 * this — rather than each doing its own expansion — is what makes "the count I
 * confirmed is the set that gets mailed" true by construction rather than by review.
 *
 * The conditions are built **once** and used twice: as the scope the search probe counts
 * inside, and as the predicate the search clause is appended to. Building them twice —
 * once for the probe, once for the predicate — is the drift this function exists to
 * make impossible.
 */
export async function resolveRecipientWhere(
	prisma: Pick<PrismaClient, 'user'>,
	filters: RecipientFilters
): Promise<{ where: Prisma.UserWhereInput; expansion: SearchExpansion }> {
	const conditions = recipientConditions(filters);
	const expansion = await expandSearch(prisma, filters.search, conditions);
	const searchClause = searchCondition(filters.search, expansion);
	return {
		where: whereFromConditions(searchClause ? [...conditions, searchClause] : conditions),
		expansion
	};
}
