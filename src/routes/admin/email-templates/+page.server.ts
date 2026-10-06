import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [settings, overrides] = await Promise.all([
		caller.settings.get(),
		caller.settings.getTemplateOverrides()
	]);
	// Prefills the Send Test recipient. hooks.server.ts guards /admin/*, so a user is present.
	return { settings, overrides, adminEmail: event.locals.user?.email ?? '' };
};
