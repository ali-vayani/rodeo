import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	// Loaded here rather than from a client-side query on mount, for the same reason
	// the queue itself is: all three are `adminProcedure` calls the page cannot render
	// without, so fetching them in the load runs them in parallel on one round trip
	// instead of leaving the filter panel to pop in a beat after the list. The facets
	// are also static for the life of the page — they describe the application form's
	// vocabulary, not the current filter selection — so there is nothing to refetch.
	//
	// The ranked list is deliberately NOT loaded here. It is the second tab, it
	// carries every scored applicant's full application, and it has to be refetched
	// on arrival anyway — scores move while the decision pass is open.
	const [queue, facets, stats] = await Promise.all([
		caller.admissions.list({ noDecision: true, scored: false }),
		caller.filters.linkedFacets(),
		caller.admissions.stats()
	]);

	return {
		applicants: queue.applicants,
		// No search term was sent, so this is `NO_EXPANSION` — carried anyway so the
		// page's state starts in the same shape every later refetch returns.
		search: queue.search,
		facets,
		stats,
		adminUid: event.locals.user?.uid ?? '',
		// Stamped onto a row the moment its score saves, so the "scored by" line
		// doesn't wait for a refetch to stop saying nobody.
		adminName: event.locals.user?.name ?? 'You'
	};
};
