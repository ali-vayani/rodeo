import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(createContext(event));
	const joinCode = event.url.searchParams.get('join');

	const [questions, responses, rawSettings, joinTeam] = await Promise.all([
		caller.questions.list({}),
		caller.application.getMyResponses(),
		caller.settings.get(),
		joinCode ? caller.team.getByInviteCode({ inviteCode: joinCode }) : Promise.resolve(null)
	]);
	const settings = 'id' in rawSettings ? rawSettings : null;

	return { user: event.locals.user!, questions, responses, settings, joinTeam };
};
