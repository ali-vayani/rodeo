import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { isAdmin } from '$lib/auth/permissions';
import { Role } from '$lib/generated/prisma/enums';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));

	// Organizers get the aggregates only. recentApplicants is admin-only, so calling it
	// for them would throw FORBIDDEN and take the whole page load down with it.
	const admin = isAdmin(event.locals.user?.role ?? Role.UNDECLARED);

	// adminStats ranks named staff against each other, so it follows recentApplicants
	// rather than the anonymous aggregates: admin-only, and null for organizers so the
	// page's shape doesn't change between the two.
	const [stats, recentApplicants, adminStats] = await Promise.all([
		caller.dashboard.stats(),
		admin ? caller.dashboard.recentApplicants({ amount: 10 }) : null,
		admin ? caller.stats.byAdmin({}) : null
	]);

	return { stats, recentApplicants, adminStats };
};
