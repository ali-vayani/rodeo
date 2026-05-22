import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

const PAGE_SIZE = 5;

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const { users, total } = await caller.user.list({ page: 1, pageSize: PAGE_SIZE });
	return { users, total, pageSize: PAGE_SIZE };
};
