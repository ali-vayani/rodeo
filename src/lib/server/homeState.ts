import type { Prisma, PrismaClient } from '$lib/generated/prisma/client';
import { loadUniversities } from '$lib/data/universities';
import { stateName, isStateCode } from '$lib/data/states';
import { INTERNATIONAL, NO_VALUE, OUT_OF_STATE, STATE_FACET_KEY, type Facet } from '$lib/facets';

/**
 * Where applicants are from, derived rather than asked.
 *
 * `User.university` already answers this through the dataset's `region`, and unlike a
 * new question it works retroactively on the whole pool. The one module both the facet
 * and the predicate go through, so a count and a filter cannot disagree.
 */

/**
 * The bucket an applicant's university places them in: a US state code,
 * `INTERNATIONAL`, or `null` for one we cannot place. `null` is folded into `NO_VALUE`,
 * because "no state on record" is honestly what we know.
 */
type Bucket = string | null;

let universityBuckets: Promise<Map<string, Bucket>> | null = null;

/**
 * Institution name to bucket, built once per process. Keyed on the plain name because
 * that is what `application.save` writes, and lowercased on both sides.
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
 * Bucketed from observed values rather than the dataset, which is the whole trick:
 * resolving "Texas" against the dataset would mean an `IN (...)` of ~200 institutions
 * and "outside Texas" one of 6,250. This bounds every list by the distinct universities
 * among applicants and makes the facet counts fall out of the same pass.
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
 * The `university` values behind a selected bucket code. Still resolves a bare state
 * code even though `stateFacet` no longer offers one: the facet governs what an
 * organizer is offered, never what the predicate accepts.
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
 * Deliberately not a list of every state observed. "Local or travelling" drives
 * catering, travel and housing, and a row per state buried it — the seeded pool read
 * "Texas 96 / Outside Texas 12 / Georgia 12", where the third row is part of the
 * second. `null` when no home state is configured, or when nobody's university places.
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
		// Both rows always, including a zero. "Nobody is local" is worth seeing, and a pair
		// that sometimes renders as one row makes the filter look like it is missing something.
		options: [
			// Named, not "Home state". The Settings field exists so this row reads "Texas":
			// an organizer filtering a Texan hackathon is thinking "Texas".
			{ value: homeState, label: stateName(homeState), count: home },
			// International is inside this row rather than beside it — see `namesFor`.
			{ value: OUT_OF_STATE, label: `Outside ${stateName(homeState)}`, count: outside }
		],
		noneCount: buckets.none.count
	};
}

/**
 * The predicate for a state selection, or `null` when nothing is selected. The caller
 * owns the `[]` case, because "match nothing" is spelled once in
 * `$lib/server/recipients` and importing it here would be a cycle.
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

	// Nothing selected resolved to anybody. That is still a narrowing selection, so it
	// must match nobody rather than dropping out and matching everybody.
	if (or.length === 0) return { university: { in: [] } };
	return or.length === 1 ? or[0] : { OR: or };
}
