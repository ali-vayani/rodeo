import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

// Matches user.list's own default. The router caps pageSize at 200, so this can
// go higher, but past ~50 rows the filter panel scrolls out of view.
const PAGE_SIZE = 50;

/**
 * The filter facets are loaded here rather than queried from the browser.
 *
 * They are a vocabulary, not a result: `filters.facets` returns global counts that do
 * not depend on the current filter, so it is fetched once per visit either way. Loading
 * it here shares the round trip the row list already makes, so the filter rail is
 * complete in the first paint. A client query would pop three controls in afterwards,
 * and on a phone the rail sits above the table, so that pop is a layout shift.
 *
 * It costs a larger HTML payload, which the server's 500-option cap already bounds.
 */
export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [list, facets, foodGroups] = await Promise.all([
		caller.user.list({ page: 1, pageSize: PAGE_SIZE }),
		caller.filters.facets(),
		// For the manual food-group override in the user detail modal. Reuses the same
		// procedure the Food Groups settings tab lists from, rather than a second
		// admin-only query that returns the same rows with a narrower select.
		caller.foodGroups.list()
	]);
	// `search` comes back so the did-you-mean strip reads its shape from the procedure
	// rather than the page re-declaring an empty expansion of its own.
	return {
		users: list.users,
		total: list.total,
		search: list.search,
		facets,
		pageSize: PAGE_SIZE,
		foodGroups: foodGroups.groups.map((g) => ({ id: g.id, name: g.name, pool: g.pool }))
	};
};
