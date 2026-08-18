import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';
import { validateEnv } from '$lib/server/env';
import { warnIncompleteWalletConfig } from '$lib/server/wallet/config';
import {
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	homePathFor,
	isAdmin,
	sectionForPath
} from '$lib/auth/permissions';

validateEnv();

// Warns, never throws — see the header comment on `wallet/config`. Wallet passes
// are the one feature here that is allowed to be absent, so a missing certificate
// must not take the application form down with it.
warnIncompleteWalletConfig();

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
		redirect(302, homePathFor(user.role));
	}

	// Guard /hacker/* and /admin/* routes
	if (pathname.startsWith('/hacker/') || pathname.startsWith('/admin/')) {
		if (!user) {
			const redirectTo = encodeURIComponent(pathname);
			redirect(302, `/login?redirectTo=${redirectTo}`);
		}

		// The two portals are disjoint: staff are turned away from /hacker/* and
		// attendees from /admin/*, each sent to the only portal their role has. Since
		// `homePathFor` is derived from the same staff/attendee split these guards
		// test, neither can redirect into a path the other will bounce back.
		if (pathname.startsWith('/hacker/') && !canAccessHackerPortal(user.role)) {
			redirect(302, homePathFor(user.role));
		}

		if (pathname.startsWith('/admin/')) {
			if (!hasPortalAccess(user.role)) redirect(302, homePathFor(user.role));

			// Per-section check, so an organizer can't reach an admin-only page just by
			// typing the URL. Guarding here rather than per-route also covers pages that
			// have no +page.server.ts of their own.
			//
			// An unmapped /admin/* path is treated as admin-only, not waved through: a new
			// admin page added without a SECTION_PATHS entry must default to the stricter
			// role, matching how the tRPC procedures fail closed. Only an admin passes.
			const section = sectionForPath(pathname);
			if (section ? !canAccess(user.role, section) : !isAdmin(user.role)) {
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
