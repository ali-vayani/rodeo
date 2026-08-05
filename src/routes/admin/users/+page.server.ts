import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

// Matches user.list's own default. The router caps pageSize at 200, so this can
// go higher, but past ~50 rows the filter panel scrolls out of view.
const PAGE_SIZE = 50;

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const { users, total } = await caller.user.list({ page: 1, pageSize: PAGE_SIZE });
	return { users, total, pageSize: PAGE_SIZE };
};
