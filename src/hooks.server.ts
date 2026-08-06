import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';
import { validateEnv } from '$lib/server/env';
import {
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	isAdmin,
	sectionForPath
} from '$lib/auth/permissions';

validateEnv();

/**
 * The path SvelteKit will actually route on.
 *
 * `event.url.pathname` is still percent-encoded, but SvelteKit matches routes
 * against the *decoded* path — so a guard that reads the raw value is bypassable:
 * `/%61dmin/users` (`%61` → `a`) fails `startsWith('/admin/')` here yet resolves to
 * the `/admin/users` route and renders it. We decode with the same algorithm the
 * framework uses (split on the literal-percent escape so `%25` isn't double-decoded)
 * so the guard and the router can never disagree on which route this is.
 */
function routedPathname(rawPathname: string): string {
	try {
		return rawPathname.split('%25').map(decodeURI).join('%25');
	} catch {
		// Malformed escape — it will 404 at routing, and no guarded route can match it.
		return rawPathname;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getSession(event);

	const pathname = routedPathname(event.url.pathname);
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
			//
			// An unmapped /admin/* path is treated as admin-only, not waved through: a new
			// admin page added without a SECTION_PATHS entry must default to the stricter
			// role, matching how the tRPC procedures fail closed. Only an admin passes.
			const section = sectionForPath(pathname);
			if (section ? !canAccess(user.roles, section) : !isAdmin(user.roles)) {
				redirect(302, '/admin/dashboard');
			}
		}
	}

	const response = await resolve(event);

	// Baseline security headers on every response. The app renders no third-party
	// content and never wants to be framed, so lock those down globally.
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	return response;
};
