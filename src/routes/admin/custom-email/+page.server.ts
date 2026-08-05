import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	// Unfiltered count for the initial "everyone" state, plus recent sends.
	const [recipients, history] = await Promise.all([
		caller.email.previewRecipients({}),
		caller.email.getLogs({ page: 1, pageSize: 10 })
	]);
	return { recipients, history };
};
