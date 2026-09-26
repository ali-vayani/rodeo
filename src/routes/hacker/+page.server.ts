import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { toSelfUser } from '$lib/server/trpc/selects';
import { prisma } from '$lib/server/db';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const [rawSettings, foodGroupMember] = await Promise.all([
		caller.settings.get(),
		// The release check belongs in the server query, never only in the page markup:
		// an unreleased group name is attendee-private data.
		prisma.foodGroupMember.findUnique({
			where: { userId: event.locals.user!.uid },
			select: { foodGroup: { select: { name: true, releasedAt: true } } }
		})
	]);

	// `settings.get` stands DEFAULT_SETTINGS in when no row exists, and every date on it
	// is `new Date()`. An `id` is the only way to tell a configured event from that
	// stand-in, and a trail of five identical timestamps is worse than no trail.
	const settings = 'id' in rawSettings ? rawSettings : null;

	return {
		user: toSelfUser(event.locals.user!),
		settings,
		foodGroup: foodGroupMember?.foodGroup.releasedAt ? foodGroupMember.foodGroup.name : null
	};
};
