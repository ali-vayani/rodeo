import type { Prisma, PrismaClient } from '$lib/generated/prisma/client';
import { loadUniversities } from '$lib/data/universities';
import { stateName, isStateCode } from '$lib/data/states';
import { INTERNATIONAL, NO_VALUE, OUT_OF_STATE, STATE_FACET_KEY, type Facet } from '$lib/facets';

/**
 * Where applicants are from, derived rather than asked.
 *
 * `User.university` already answers this: the university dataset carries a `region` per
 * institution, so "is this applicant from Texas" is a lookup, not a new question on the
 * form. That matters more than it sounds — a question added now is unanswered by every
 * applicant who already applied, whereas this works retroactively on the whole pool.
 *
 * The one module both the facet and the predicate go through, for the same reason
 * `$lib/server/recipients` is: a count an organizer reads and the rows a filter returns
 * have to be derived by the same code or they disagree, and "Texas: 214" above 190 rows
 * is the kind of disagreement nobody reports and everybody stops trusting.
 */

/**
 * The bucket an applicant's university places them in.
 *
 * A US state code, `INTERNATIONAL` for an institution we can place outside the US, or
 * `null` for one we cannot place at all — a write-in, or a US row the dataset carries
 * no region for. `null` is folded into `NO_VALUE` where it surfaces, because "no state
 * on record" is honestly what we know about them; claiming a state would be worse.
 */
type Bucket = string | null;

let universityBuckets: Promise<Map<string, Bucket>> | null = null;

/**
 * Institution name → bucket, built once per process.
 *
 * Keyed on the plain institution name because that is exactly what `application.save`
 * writes into `User.university` — the preset deliberately stores the bare name, not the
 * decorated `Name — City, ST` label. Lowercased on both sides so a stored answer that
 * differs only in case still places.
 */
function loadBuckets(): Promise<Map<string, Bucket>> {
	universityBuckets ??= loadUniversities().then(({ universities }) => {
		const buckets = new Map<string, Bucket>();
		for (const university of universities) {
			const bucket =
				university.country === 'US'
					? isStateCode(university.region)
						? university.region
						: null
					: INTERNATIONAL;
			buckets.set(university.name.toLowerCase(), bucket);
		}
		return buckets;
	});
	return universityBuckets;
}

/** What one bucket holds: how many users, and the exact `university` values behind it. */
interface BucketTally {
	count: number;
	/** The stored values themselves, so the predicate is an exact `IN (...)`. */
	names: string[];
}

interface Buckets {
	byCode: Map<string, BucketTally>;
	/** Users with no university at all, plus those whose university we cannot place. */
	none: BucketTally;
	total: number;
}

/**
 * Every university anyone actually holds, bucketed by state.
 *
 * Bucketed from the *observed* values rather than from the dataset, and that is the
 * whole trick: resolving "Texas" against the dataset would mean an `IN (...)` of the
 * ~200 Texan institutions, and "outside Texas" an `IN (...)` of the other 6,250 —
 * a query nobody wants to read or plan. Bucketing what the pool actually contains
 * bounds every list by the number of distinct universities among applicants, which is
 * a few hundred at most, and it makes the facet counts fall out of the same pass.
 *
 * The same resolve-to-explicit-values move `expandSearch` makes for fuzzy names, for
 * the same reason: the predicate stays exact, so preview and send cannot diverge.
 */
export async function stateBuckets(prisma: Pick<PrismaClient, 'user'>): Promise<Buckets> {
	const [placement, rows] = await Promise.all([
		loadBuckets(),
		prisma.user.groupBy({ by: ['university'], _count: { _all: true } })
	]);

	const byCode = new Map<string, BucketTally>();
	const none: BucketTally = { count: 0, names: [] };
	let total = 0;

	for (const row of rows) {
		const value = row.university;
		const count = row._count._all;
		total += count;

		// `''` is absent everywhere: the write-through in `application.save` does not trim,
		// so a blank answer stores an empty string rather than leaving the column NULL.
		if (typeof value !== 'string' || value === '') {
			none.count += count;
			continue;
		}

		const bucket = placement.get(value.toLowerCase()) ?? null;
		if (bucket === null) {
			// A university we can't place. The row still exists and still has to be
			// reachable, so it lands under "no state on record" rather than vanishing.
			none.count += count;
			none.names.push(value);
			continue;
		}

		const tally = byCode.get(bucket) ?? { count: 0, names: [] };
		tally.count += count;
		tally.names.push(value);
		byCode.set(bucket, tally);
	}

	return { byCode, none, total };
}

/**
 * The `university` values behind a selected bucket code.
 *
 * Still resolves a bare state code — `CA` — even though `stateFacet` no longer offers
 * one. That mirrors `FILTERABLE_LINKED_FIELDS`: the facet governs what an organizer is
 * *offered*, never what the predicate *accepts*. Costs one line, keeps a hand-built
 * query working, and means restoring a per-state control later is a UI change alone.
 */
function namesFor(buckets: Buckets, code: string, homeState: string | null): string[] {
	if (code !== OUT_OF_STATE) return buckets.byCode.get(code)?.names ?? [];
	// Everyone we *can* place who isn't at home — international included, since an
	// applicant flying in from Toronto is no less not-from-Texas than one from Atlanta.
	const names: string[] = [];
	for (const [bucket, tally] of buckets.byCode) {
		if (bucket !== homeState) names.push(...tally.names);
	}
	return names;
}

/**
 * The state facet: home, and not home. Two rows, or `null`.
 *
 * Deliberately *not* a list of every state observed. The question an organizer actually
 * asks of a hackathon's applicant pool is "local or travelling" — that drives catering,
 * travel reimbursement and housing. A row per state answered a question nobody was
 * asking and buried the one they were: on the seeded pool the list read "Texas 96 /
 * Outside Texas 12 / Georgia 12", where the third row is the second row, re-stated.
 *
 * So this is a partition now, not a set of alternative cuts, and the two counts plus
 * `noneCount` sum to the whole table.
 *
 * `null` when no home state is configured, because without one there is no "home" and
 * no "outside" — the pair is the whole facet, so half of it missing means no facet. Also
 * `null` when nobody's university places anywhere, since an empty control invites an
 * organizer to filter on something the data cannot answer.
 */
export async function stateFacet(
	prisma: Pick<PrismaClient, 'user'>,
	homeState: string | null
): Promise<Facet | null> {
	if (!homeState) return null;

	const buckets = await stateBuckets(prisma);
	if (buckets.byCode.size === 0) return null;

	const home = buckets.byCode.get(homeState)?.count ?? 0;
	const outside = [...buckets.byCode]
		.filter(([code]) => code !== homeState)
		.reduce((sum, [, tally]) => sum + tally.count, 0);

	return {
		key: STATE_FACET_KEY,
		label: 'State',
		control: 'select',
		// Both rows always, including a zero. A count of zero is an answer — "nobody is
		// local" is worth seeing — and a pair that sometimes renders as one row makes the
		// filter look like it is missing something.
		options: [
			// Named, not "Home state". The Settings field exists so this row reads "Texas":
			// an organizer filtering a Texan hackathon is thinking "Texas".
			{ value: homeState, label: stateName(homeState), count: home },
			// International is inside this row rather than beside it. "Not from Texas" is
			// one question, and an applicant flying in from Toronto is no less not-from-Texas
			// than one driving from Atlanta.
			{ value: OUT_OF_STATE, label: `Outside ${stateName(homeState)}`, count: outside }
		],
		noneCount: buckets.none.count
	};
}

/**
 * The predicate for a state selection, or `null` when nothing is selected.
 *
 * Follows the same engaged-but-empty rule as every other facet — but the *caller* owns
 * the `[]` case, because "match nothing" is spelled once in `$lib/server/recipients`
 * and importing it here would be a cycle.
 */
export async function stateCondition(
	prisma: Pick<PrismaClient, 'user'>,
	selected: readonly string[],
	homeState: string | null
): Promise<Prisma.UserWhereInput | null> {
	if (selected.length === 0) return null;

	const buckets = await stateBuckets(prisma);
	const or: Prisma.UserWhereInput[] = [];

	const names = new Set<string>();
	for (const code of selected) {
		if (code === NO_VALUE) continue;
		for (const name of namesFor(buckets, code, homeState)) names.add(name);
	}
	if (names.size) or.push({ university: { in: [...names] } });

	if (selected.includes(NO_VALUE)) {
		or.push({ university: null }, { university: '' });
		// Write-ins we couldn't place. Listed explicitly rather than expressed as a
		// NOT IN, because the complement is the whole dataset and this set is small.
		if (buckets.none.names.length) or.push({ university: { in: buckets.none.names } });
	}

	// Nothing selected resolved to anybody — a state whose only holders have since been
	// deleted, say. That is still a narrowing selection, so it must match nobody rather
	// than dropping out and matching everybody.
	if (or.length === 0) return { university: { in: [] } };
	return or.length === 1 ? or[0] : { OR: or };
}
