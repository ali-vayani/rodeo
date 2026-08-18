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
 * They are a *vocabulary*, not a result: `filters.facets` returns global counts
 * that don't depend on anything the page is currently filtering on, so it is fetched
 * exactly once per visit either way. Loading it here makes that one fetch share the
 * round trip the row list already makes through the in-process caller, so the filter
 * rail is complete in the first paint. A client query would render an empty rail, then
 * pop three controls into it — and on a phone the rail sits *above* the table, so that
 * pop is a layout shift under the reader's thumb.
 *
 * It costs a larger HTML payload (the Full Name facet alone is the server's 500-option
 * cap). That cap is the reason it is affordable, and it is already tuned for this.
 */
export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [list, facets] = await Promise.all([
		caller.user.list({ page: 1, pageSize: PAGE_SIZE }),
		caller.filters.facets()
	]);
	// `search` comes back so the did-you-mean strip reads its shape from the procedure
	// rather than the page re-declaring an empty expansion of its own.
	return { users: list.users, total: list.total, search: list.search, facets, pageSize: PAGE_SIZE };
};
