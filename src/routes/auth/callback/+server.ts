import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

/**
 * Where Google returns to after the OAuth handshake.
 *
 * Deliberately does *not* pick a landing page itself. `/` already resolves the
 * portal from the user's roles, and duplicating that here is how the two drift —
 * this route used to send everyone to `/admin/dashboard`, which bounced every
 * hacker straight back out through the admin guard.
 */
export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const next = event.url.searchParams.get('next');

	// Same-origin paths only. `next` comes off the query string, so accepting an
	// absolute URL would turn the login flow into an open redirect.
	const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/';

	if (code) {
		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(302, destination);
		}
	}

	redirect(302, '/login?error=oauth_failed');
};
