import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

// `?join=` is no longer read here — `hacker/+layout.server.ts` owns the invitation
// now, so the banner it drives outlives this page.
export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	const [questions, responses, rawSettings] = await Promise.all([
		caller.questions.list({}),
		caller.application.getMyResponses(),
		caller.settings.get()
	]);
	const settings = 'id' in rawSettings ? rawSettings : null;

	return { user: event.locals.user!, questions, responses, settings };
};
