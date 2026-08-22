import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';
import { validateEnv } from '$lib/server/env';
import { warnIncompleteWalletConfig } from '$lib/server/wallet/config';
import { warnIncompleteS3Config } from '$lib/server/s3';
import { reportStorageBackend } from '$lib/server/storage';
import {
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	homePathFor,
	isAdmin,
	sectionForPath
} from '$lib/auth/permissions';

validateEnv();

warnIncompleteWalletConfig();
warnIncompleteS3Config();

// Which backend uploads are going to, when it isn't a bucket.
reportStorageBackend();

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
		return rawPathname;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getSession(event);

	const pathname = routedPathname(event.url.pathname);
	const user = event.locals.user;

	if (pathname === '/login' && user) {
		redirect(302, homePathFor(user.role));
	}

	if (pathname.startsWith('/hacker/') || pathname.startsWith('/admin/')) {
		if (!user) {
			const redirectTo = encodeURIComponent(pathname);
			redirect(302, `/login?redirectTo=${redirectTo}`);
		}

		if (pathname.startsWith('/hacker/') && !canAccessHackerPortal(user.role)) {
			redirect(302, homePathFor(user.role));
		}

		if (pathname.startsWith('/admin/')) {
			if (!hasPortalAccess(user.role)) redirect(302, homePathFor(user.role));

			const section = sectionForPath(pathname);
			if (section ? !canAccess(user.role, section) : !isAdmin(user.role)) {
				redirect(302, '/admin/dashboard');
			}
		}
	}

	const response = await resolve(event);

	// A response that already carries a frame policy has chosen one — today only the
	// inline PDF the viewer frames from this same origin.
	if (!response.headers.has('X-Frame-Options')) {
		response.headers.set('X-Frame-Options', 'DENY');
	}
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	return response;
};
