import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { fetchProjects } from '$lib/server/projects';

const createCaller = createCallerFactory(appRouter);

/**
 * Loads regardless of the toggle: staff need to see the list before switching it on
 * for hackers. The page says when it is hidden from them.
 */
export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const settings = await caller.settings.get();
	const feed = await fetchProjects(settings.projectsUrl);
	return { ...feed, projectsEnabled: settings.projectsEnabled };
};
