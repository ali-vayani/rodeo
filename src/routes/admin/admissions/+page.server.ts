import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const applicants = await caller.admissions.list({ noDecision: true });
	return { applicants, adminUid: event.locals.user?.uid ?? '' };
};
