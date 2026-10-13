import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { toSelfUser } from '$lib/server/trpc/selects';

const createCaller = createCallerFactory(appRouter);

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user!;

	// The rail only shows the tab to invited accounts; a typed URL gets the same rule.
	if (!user.walkInInvitedAt) redirect(302, '/hacker');

	const caller = createCaller(createContext(event));
	const [questions, responses] = await Promise.all([
		caller.questions.list({}),
		caller.application.getMyResponses()
	]);

	return { user: toSelfUser(user), questions, responses };
};
