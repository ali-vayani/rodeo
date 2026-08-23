import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

/**
 * Restricts an untrusted redirect target to this origin. `next` comes off the query
 * string, so accepting an absolute URL would turn the login flow into an open redirect.
 * Resolving against our own origin is what catches `/\evil.com`, which a plain
 * `startsWith('/')` check let through and the browser resolves cross-origin.
 *
 * Inputs:
 * - raw: string | null — the `next` query param, possibly absent or malformed
 * - origin: string — this deployment's origin
 *
 * Outputs:
 * - string — a same-origin path with query and hash, or `/` for anything else
 */
function safeInternalPath(raw: string | null, origin: string): string {
	if (!raw) return '/';
	try {
		const url = new URL(raw, origin);
		return url.origin === origin ? url.pathname + url.search + url.hash : '/';
	} catch {
		return '/';
	}
}

/**
 * Where Google returns to after the OAuth handshake.
 *
 * Deliberately does not pick a landing page itself. `/` already resolves the portal from
 * the user's role, and duplicating that here is how the two drift: this route used to
 * send everyone to `/admin/dashboard`, bouncing every hacker straight back out.
 */
export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const next = event.url.searchParams.get('next');

	const destination = safeInternalPath(next, event.url.origin);

	if (code) {
		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(302, destination);
		}
	}

	redirect(302, '/login?error=oauth_failed');
};
