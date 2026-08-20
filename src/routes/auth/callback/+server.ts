import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

/** A same-origin path from an untrusted `next`, or `/` if it points anywhere else. */
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

	// Same-origin paths only. `next` comes off the query string, so accepting an
	// absolute URL would turn the login flow into an open redirect. Resolve against our
	// own origin and require it to stay there — a plain `startsWith('/') && !'//'` prefix
	// check let `/\evil.com` through, which the browser resolves cross-origin.
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
