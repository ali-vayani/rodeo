import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { stateBuckets, stateCondition, stateFacet } from './homeState';
import { INTERNATIONAL, NO_VALUE, OUT_OF_STATE, STATE_FACET_KEY } from '$lib/facets';

/**
 * Institutions taken from the real dataset, because the mapping under test IS the
 * dataset. Faking it would prove only that the fake is consistent with itself.
 */
const RICE = 'Rice University'; // TX
const UT = 'The University of Texas at Austin'; // TX
const STANFORD = 'Stanford University'; // CA
const MIT = 'Massachusetts Institute of Technology'; // MA
const TORONTO = 'University of Toronto'; // CA the country, not the state
const WRITE_IN = 'Riverbend Institute of Technology';

/** A `user.groupBy(['university'])` result, which is the only query these read. */
function prismaWith(rows: [string | null, number][]) {
	return {
		user: {
			groupBy: async () =>
				rows.map(([university, count]) => ({ university, _count: { _all: count } }))
		}
	} as unknown as Pick<PrismaClient, 'user'>;
}

describe('stateBuckets', () => {
	it('places a university by the region the dataset carries for it', async () => {
		const buckets = await stateBuckets(prismaWith([[RICE, 4]]));
		expect(buckets.byCode.get('TX')).toEqual({ count: 4, names: [RICE] });
	});

	it('sums two universities in the same state into one bucket', async () => {
		const buckets = await stateBuckets(
			prismaWith([
				[RICE, 4],
				[UT, 10]
			])
		);
		expect(buckets.byCode.get('TX')?.count).toBe(14);
		expect(buckets.byCode.get('TX')?.names).toEqual([RICE, UT]);
	});

	it('buckets a non-US institution as international, not as a state', async () => {
		// Its `region` is "Ontario", which is a real region and not a US state code.
		const buckets = await stateBuckets(prismaWith([[TORONTO, 3]]));
		expect(buckets.byCode.get(INTERNATIONAL)?.count).toBe(3);
		expect([...buckets.byCode.keys()]).not.toContain('Ontario');
	});

	it('counts a blank university and a NULL one as the same absence', async () => {
		const buckets = await stateBuckets(
			prismaWith([
				[null, 500],
				['', 30]
			])
		);
		expect(buckets.none.count).toBe(530);
		expect(buckets.none.names).toEqual([]);
	});

	it('folds a write-in we cannot place into "no state", keeping it selectable', async () => {
		// The row still exists and still has to be reachable. Guessing a state for it
		// would be worse than admitting we do not know.
		const buckets = await stateBuckets(prismaWith([[WRITE_IN, 2]]));
		expect(buckets.none.count).toBe(2);
		expect(buckets.none.names).toEqual([WRITE_IN]);
		expect(buckets.byCode.size).toBe(0);
	});

	it('places a stored value that differs only in case', async () => {
		const buckets = await stateBuckets(prismaWith([[RICE.toUpperCase(), 1]]));
		expect(buckets.byCode.get('TX')?.count).toBe(1);
	});
});

describe('stateFacet', () => {
	const pool: [string | null, number][] = [
		[RICE, 4],
		[UT, 10],
		[STANFORD, 6],
		[MIT, 2],
		[TORONTO, 3],
		[null, 20]
	];

	it('is absent, not empty, when nothing places anywhere', async () => {
		// An empty control invites an organizer to filter on something the data cannot
		// answer.
		expect(await stateFacet(prismaWith([[null, 5]]), 'TX')).toBeNull();
	});

	it('leads with the home state, named rather than coded', async () => {
		// The whole point of the Settings field: the row reads "Texas", because that is
		// what an organizer filtering a Texan hackathon is thinking.
		const facet = await stateFacet(prismaWith(pool), 'TX');
		expect(facet?.options[0]).toEqual({ value: 'TX', label: 'Texas', count: 14 });
	});

	it('offers "outside <home>" as the other half of the pair', async () => {
		const facet = await stateFacet(prismaWith(pool), 'TX');
		expect(facet?.options[1]).toEqual({
			value: OUT_OF_STATE,
			label: 'Outside Texas',
			count: 11
		});
	});

	it('offers nothing but the pair — no row per state', async () => {
		// The question an organizer asks of an applicant pool is "local or travelling".
		// A row per state answered a question nobody asked and buried the one they did:
		// "Texas 96 / Outside Texas 12 / Georgia 12", where the third row IS the second.
		const facet = await stateFacet(prismaWith(pool), 'TX');
		expect(facet?.options).toHaveLength(2);
		expect(facet?.options.map((o) => o.value)).toEqual(['TX', OUT_OF_STATE]);
	});

	it('folds international into "outside", not beside it', async () => {
		// Someone flying in from Toronto is no less not-from-Texas than one from Atlanta.
		const facet = await stateFacet(prismaWith(pool), 'TX');
		expect(facet?.options.map((o) => o.value)).not.toContain(INTERNATIONAL);
		expect(facet?.options[1].count).toBe(11); // Stanford 6 + MIT 2 + Toronto 3
	});

	it('is absent entirely when no home state is configured', async () => {
		// Without a home there is no "outside" either, and the pair is the whole facet —
		// so half of it missing means no facet rather than a fallback list of states.
		expect(await stateFacet(prismaWith(pool), null)).toBeNull();
	});

	it('keeps both rows even when one of them is zero', async () => {
		// "Nobody is local" is an answer worth seeing, and a pair that sometimes renders
		// as a single row makes the filter look like it is missing something.
		const allHome = await stateFacet(prismaWith([[RICE, 4]]), 'TX');
		expect(allHome?.options).toEqual([
			{ value: 'TX', label: 'Texas', count: 4 },
			{ value: OUT_OF_STATE, label: 'Outside Texas', count: 0 }
		]);

		const noneHome = await stateFacet(prismaWith([[STANFORD, 6]]), 'TX');
		expect(noneHome?.options).toEqual([
			{ value: 'TX', label: 'Texas', count: 0 },
			{ value: OUT_OF_STATE, label: 'Outside Texas', count: 6 }
		]);
	});

	it('partitions the table: home + outside + none is everyone', async () => {
		// True now in a way it was not before. The old list overlapped on purpose, so its
		// counts could not be added up; these can, and a reader will add them up.
		const facet = await stateFacet(prismaWith(pool), 'TX');
		const total = facet!.options.reduce((sum, o) => sum + o.count, 0) + facet!.noneCount;
		expect(total).toBe(pool.reduce((sum, [, count]) => sum + count, 0));
	});

	it('reports the unplaceable as its noneCount, under one stable key', async () => {
		const facet = await stateFacet(prismaWith([...pool, [WRITE_IN, 2]]), 'TX');
		expect(facet?.key).toBe(STATE_FACET_KEY);
		expect(facet?.noneCount).toBe(22);
	});
});

describe('stateCondition', () => {
	const pool: [string | null, number][] = [
		[RICE, 4],
		[UT, 10],
		[STANFORD, 6],
		[TORONTO, 3],
		[WRITE_IN, 2],
		[null, 20]
	];

	it('is null for an empty selection, leaving the caller to spell match-nothing', async () => {
		expect(await stateCondition(prismaWith(pool), [], 'TX')).toBeNull();
	});

	it('resolves a state to the universities the pool actually contains', async () => {
		// Bounded by the applicant pool, not by the 6,400-row dataset — which is what
		// keeps "outside Texas" from becoming an IN clause with six thousand entries.
		expect(await stateCondition(prismaWith(pool), ['TX'], 'TX')).toEqual({
			university: { in: [RICE, UT] }
		});
	});

	it('resolves out-of-state to everything placeable that is not home', async () => {
		expect(await stateCondition(prismaWith(pool), [OUT_OF_STATE], 'TX')).toEqual({
			university: { in: [STANFORD, TORONTO] }
		});
	});

	it('unions two selected states into one clause', async () => {
		expect(await stateCondition(prismaWith(pool), ['TX', 'CA'], 'TX')).toEqual({
			university: { in: [RICE, UT, STANFORD] }
		});
	});

	it('reads the no-value sentinel as blank, NULL, or unplaceable', async () => {
		expect(await stateCondition(prismaWith(pool), [NO_VALUE], 'TX')).toEqual({
			OR: [{ university: null }, { university: '' }, { university: { in: [WRITE_IN] } }]
		});
	});

	it('ORs the sentinel alongside a real state', async () => {
		const condition = await stateCondition(prismaWith(pool), ['CA', NO_VALUE], 'TX');
		expect(condition).toEqual({
			OR: [
				{ university: { in: [STANFORD] } },
				{ university: null },
				{ university: '' },
				{ university: { in: [WRITE_IN] } }
			]
		});
	});

	it('matches nobody when a selected state resolves to no one', async () => {
		// A state whose only holders have since been deleted. Still a narrowing
		// selection, so it must not drop out and match everybody.
		expect(await stateCondition(prismaWith(pool), ['WY'], 'TX')).toEqual({
			university: { in: [] }
		});
	});

	it('treats out-of-state with no home configured as "anywhere we can place"', async () => {
		// Nothing is home, so nothing is excluded. Reachable only by a direct API call —
		// the facet does not offer the row without a home state.
		expect(await stateCondition(prismaWith(pool), [OUT_OF_STATE], null)).toEqual({
			university: { in: [RICE, UT, STANFORD, TORONTO] }
		});
	});
});
