import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { isAdmin } from '$lib/auth/permissions';
import { Role } from '$lib/generated/prisma/enums';

const createCaller = createCallerFactory(appRouter);

/** The window the page renders before the reader touches the control. */
const DEFAULT_WINDOW = 'all' as const;

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	// Organizers get the aggregates only. The three admin-only calls name people, so
	// calling them for an organizer would throw FORBIDDEN and take the whole page load
	// down. They come back null instead.
	const admin = isAdmin(event.locals.user?.role ?? Role.UNDECLARED);

	const [stats, funnel, trend, activity, adminStats, demographics] = await Promise.all([
		caller.dashboard.stats(),
		caller.dashboard.funnel(),
		caller.dashboard.overTime({ window: DEFAULT_WINDOW }),
		admin ? caller.dashboard.activity({ source: 'all', window: DEFAULT_WINDOW, limit: 8 }) : null,
		admin ? caller.stats.byAdmin({}) : null,
		admin ? caller.dashboard.demographics({ top: 7 }) : null
	]);

	return { stats, funnel, trend, activity, adminStats, demographics, window: DEFAULT_WINDOW };
};
