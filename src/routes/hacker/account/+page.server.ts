import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	const [user, rawSettings, wallet] = await Promise.all([
		caller.user.me(),
		caller.settings.get(),
		caller.wallet.availability()
	]);
	// `settings.get()` substitutes DEFAULT_SETTINGS on a fresh install, and that
	// object's dates are placeholders rather than a configured event. Narrowing on
	// `id` keeps the page from presenting them as real deadlines.
	const settings = 'id' in rawSettings ? rawSettings : null;

	return { user, settings, wallet };
};
