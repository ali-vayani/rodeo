import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { setSessionCookie } from '$lib/server/auth';
import { usesSupabaseAuth } from '$lib/server/env';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, '/');

	const supabaseAuth = usesSupabaseAuth();

	return {
		supabaseAuth,
		oauthError: url.searchParams.get('error'),
		// Where to land after the handshake. Carried through Supabase's redirect
		// rather than a cookie, so a deep link survives the round trip.
		redirectTo: url.searchParams.get('redirectTo'),
		// The anon key goes to the browser deliberately: it is a public credential
		// — row-level security is what protects the data — and the OAuth redirect
		// has to be initiated client-side.
		supabaseUrl: supabaseAuth ? (env.SUPABASE_URL ?? null) : null,
		supabaseAnonKey: supabaseAuth ? (env.SUPABASE_ANON_KEY ?? null) : null
	};
};

/**
 * Where to land after signing in, restricted to this origin.
 *
 * `redirectTo` arrives on the query string, so an absolute URL would make the
 * login form an open redirect: a link that genuinely starts on Rodeo and ends on
 * someone else's page, one step after the user typed their address. Same rule as
 * the OAuth callback (`src/routes/auth/callback/+server.ts`), which had the check
 * and this path did not. Decoding a malformed escape throws, and a bad link
 * shouldn't 500 the login page, so that falls back to the default too.
 */
function safeRedirect(raw: string | null, origin: string): string {
	if (!raw) return '/';

	// Resolve against our own origin and require it to *stay* there. The prefix check
	// this replaces (`startsWith('/') && !startsWith('//')`) let `/\evil.com` through:
	// a backslash isn't `/`, but the browser treats it as one, so the value resolved to
	// `https://evil.com`. `searchParams.get` has already decoded the value once, so there
	// is no second decodeURIComponent here (that double-decode could inject a CR/LF and
	// 500 the redirect).
	let url: URL;
	try {
		url = new URL(raw, origin);
	} catch {
		return '/';
	}
	return url.origin === origin ? url.pathname + url.search + url.hash : '/';
}

/**
 * The dev bypass, and only the dev bypass.
 *
 * Deployed environments sign in through Google, so there is no password form to
 * post to. The guard refuses outright rather than falling through to a lookup
 * that would log someone in on an email address alone.
 */
export const actions: Actions = {
	default: async (event) => {
		if (usesSupabaseAuth()) {
			return fail(400, { error: 'Sign in with Google.' });
		}

		const data = await event.request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();

		if (!email) return fail(400, { error: 'Email is required.' });

		if (!email.endsWith('@yopmail.com')) {
			return fail(400, { error: 'Only @yopmail.com emails are allowed in dev mode.' });
		}

		const user = await prisma.user.findUnique({ where: { email } });
		if (!user) {
			return fail(404, { error: 'No account found for that email.' });
		}

		setSessionCookie(event, user.uid);

		redirect(302, safeRedirect(event.url.searchParams.get('redirectTo'), event.url.origin));
	}
};
