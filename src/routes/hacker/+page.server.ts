import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { toSelfUser } from '$lib/server/trpc/selects';
import { prisma } from '$lib/server/db';
import { Role } from '$lib/generated/prisma/client';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const user = event.locals.user!;
	const [rawSettings, foodGroupMember] = await Promise.all([
		caller.settings.get(),
		// Food groups are hacker-only — /hacker is shared by every non-staff role (judges,
		// mentors, volunteers included), so this skips the query entirely for anyone else.
		// Belt and suspenders: even a stray FoodGroupMember row (say, from someone
		// reclassified to Volunteer after already being assigned a group) still can't
		// surface here. The release check belongs in the server query, never only in the
		// page markup: an unreleased group name is attendee-private data.
		user.role === Role.HACKER
			? prisma.foodGroupMember.findUnique({
					where: { userId: user.uid },
					select: { foodGroup: { select: { name: true, releasedAt: true } } }
				})
			: null
	]);

	// `settings.get` stands DEFAULT_SETTINGS in when no row exists, and every date on it
	// is `new Date()`. An `id` is the only way to tell a configured event from that
	// stand-in, and a trail of five identical timestamps is worse than no trail.
	const settings = 'id' in rawSettings ? rawSettings : null;

	return {
		user: toSelfUser(user),
		settings,
		foodGroup: foodGroupMember?.foodGroup.releasedAt ? foodGroupMember.foodGroup.name : null
	};
};
