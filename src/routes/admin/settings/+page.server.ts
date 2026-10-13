import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [settings, foodGroups] = await Promise.all([
		caller.settings.get(),
		caller.foodGroups.list()
	]);

	// Straight off the session rather than through a `me` procedure: the hook has already
	// resolved this row to decide the request was allowed in. Only the fields the card
	// shows, not the whole user, which carries claim and decision state.
	const user = event.locals.user;
	const me = user && {
		name: user.name,
		email: user.email,
		role: user.role,
		createdAt: user.createdAt
	};

	return { settings, me, foodGroups };
};
