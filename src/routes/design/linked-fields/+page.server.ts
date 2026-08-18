import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPortalAccess } from '$lib/auth/permissions';

/**
 * Same guard as `/design`, for the same reason.
 *
 * `hooks.server.ts` protects `/hacker/*` and `/admin/*` by prefix and `/design/*`
 * matches neither, and a `+page.server.ts` one directory up does not cover a child
 * route — so this page needs its own copy or it ships to anyone who guesses the path.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}

	if (!hasPortalAccess(locals.user.role)) {
		error(404, 'Not found');
	}
};
