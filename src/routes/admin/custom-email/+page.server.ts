import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	// Unfiltered count for the initial "everyone" state, recent sends, and the date
	// variables, rendered server-side so the compose preview substitutes the exact strings
	// the send will. The filter facets ride along for the same reason as on /admin/users.
	const [recipients, history, eventVars, facets] = await Promise.all([
		caller.email.previewRecipients({}),
		caller.email.getLogs({ page: 1, pageSize: 10 }),
		caller.email.eventVars(),
		caller.filters.facets()
	]);
	return { recipients, history, eventVars, facets };
};
