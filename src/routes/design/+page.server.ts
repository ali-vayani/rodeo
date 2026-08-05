import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPortalAccess } from '$lib/auth/permissions';

/**
 * The style guide is an internal reference, not part of the public site.
 *
 * `hooks.server.ts` guards `/hacker/*` and `/admin/*` by prefix, and `/design`
 * matches neither — so without this it ships to anyone who guesses the path. The
 * guard lives here rather than as another prefix in the hook because it protects
 * exactly one page, and the rule is easier to trust sitting next to it.
 *
 * A signed-in hacker gets a 404 rather than a 403: the page holds no user data,
 * but there is no reason to confirm to an attendee that it exists.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}

	if (!hasPortalAccess(locals.user.roles)) {
		error(404, 'Not found');
	}
};
