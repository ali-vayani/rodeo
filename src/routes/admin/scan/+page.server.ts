import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [settings, recentScans, scanCounts] = await Promise.all([
		caller.settings.get(),
		caller.scan.getRecent({ limit: 20 }),
		caller.scan.getCounts()
	]);

	return {
		scanActions: settings.scanActions,
		recentScans,
		scanCounts
	};
};
