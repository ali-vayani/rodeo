import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';
import { validateEnv } from '$lib/server/env';
import {
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	sectionForPath
} from '$lib/auth/permissions';

validateEnv();

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getSession(event);

	const { pathname } = event.url;
	const user = event.locals.user;

	// Redirect authenticated users away from login
	if (pathname === '/login' && user) {
		redirect(302, hasPortalAccess(user.roles) ? '/admin/dashboard' : '/hacker/application');
	}

	// Guard /hacker/* and /admin/* routes
	if (pathname.startsWith('/hacker/') || pathname.startsWith('/admin/')) {
		if (!user) {
			const redirectTo = encodeURIComponent(pathname);
			redirect(302, `/login?redirectTo=${redirectTo}`);
		}

		// Organizers are staff, not attendees — they have no application to fill out.
		if (pathname.startsWith('/hacker/') && !canAccessHackerPortal(user.roles)) {
			redirect(302, '/admin/dashboard');
		}

		if (pathname.startsWith('/admin/')) {
			if (!hasPortalAccess(user.roles)) redirect(302, '/hacker/application');

			// Per-section check, so an organizer can't reach an admin-only page just by
			// typing the URL. Guarding here rather than per-route also covers pages that
			// have no +page.server.ts of their own.
			const section = sectionForPath(pathname);
			if (section && !canAccess(user.roles, section)) redirect(302, '/admin/dashboard');
		}
	}

	return resolve(event);
};
