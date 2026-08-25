import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { toSelfUser } from '$lib/server/trpc/selects';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const rawSettings = await caller.settings.get();

	// `settings.get` stands DEFAULT_SETTINGS in when no row exists, and every date on it
	// is `new Date()`. An `id` is the only way to tell a configured event from that
	// stand-in, and a trail of five identical timestamps is worse than no trail.
	const settings = 'id' in rawSettings ? rawSettings : null;

	return { user: toSelfUser(event.locals.user!), settings };
};
