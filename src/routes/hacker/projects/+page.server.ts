import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { fetchProjects } from '$lib/server/projects';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const settings = await caller.settings.get();

	// The rail only shows the tab while the toggle is on; a typed URL gets the same rule.
	if (!settings.projectsEnabled) redirect(302, '/hacker');

	return fetchProjects(settings.projectsUrl);
};
