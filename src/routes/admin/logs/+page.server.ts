import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

/**
 * Only the first page is server-rendered. Every filter change and page step goes back
 * through tRPC from the client, since the trail is append-only and can run to thousands
 * of rows.
 */
export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	const [initial, actors] = await Promise.all([
		caller.log.list({ page: 1, pageSize: 50 }),
		caller.log.actors()
	]);

	return { initial, actors };
};
