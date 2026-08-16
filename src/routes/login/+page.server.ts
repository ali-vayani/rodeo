import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { setSessionCookie } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth, yopmailLoginEnabled } from '$lib/server/env';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, '/');

	const supabaseAuth = usesSupabaseAuth();

	return {
		supabaseAuth,
		// Preview deploys offer both: Google, and the seeded test accounts.
		yopmailLogin: yopmailLoginEnabled(),
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

export const actions: Actions = {
	/**
	 * The yopmail bypass: development and preview deploys, never production.
	 *
	 * The guard refuses outright rather than falling through to a lookup that
	 * would log someone in on an email address alone.
	 *
	 * `redirectTo` travels as a hidden input rather than on the query string:
	 * posting to a named action (`?/yopmail`) replaces the page's query string,
	 * which would drop the deep link.
	 */
	yopmail: async (event) => {
		if (!yopmailLoginEnabled()) {
			return fail(400, { error: 'Sign in with Google or a password.' });
		}

		const data = await event.request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();

		if (!email) return fail(400, { error: 'Email is required.' });

		if (!email.endsWith('@yopmail.com')) {
			return fail(400, { error: 'Only @yopmail.com test accounts can sign in this way.' });
		}

		const user = await prisma.user.findUnique({ where: { email } });
		if (!user) {
			return fail(404, { error: 'No account found for that email.' });
		}

		setSessionCookie(event, user.uid);

		redirect(302, safeRedirect(data.get('redirectTo') as string | null, event.url.origin));
	},

	/**
	 * Supabase email/password sign-in. The server client writes the session
	 * cookies through the same adapter the OAuth callback uses, so nothing else
	 * changes downstream — getProdSession picks the session up on the redirect.
	 */
	password: async (event) => {
		if (!usesSupabaseAuth()) {
			return fail(400, { passwordError: 'Password sign-in is not available here.' });
		}

		const data = await event.request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;

		if (!email || !password) {
			return fail(400, { passwordError: 'Email and password are required.' });
		}

		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		if (error) {
			// Supabase's messages here are already user-facing ("Invalid login
			// credentials", "Email not confirmed") and distinguishing them matters:
			// an unconfirmed signup should be told to check their inbox, not that
			// their password is wrong.
			return fail(400, { passwordError: error.message });
		}

		redirect(302, safeRedirect(data.get('redirectTo') as string | null, event.url.origin));
	},

	/**
	 * Supabase email/password sign-up. The local User row is not created here —
	 * getProdSession provisions it from the Supabase identity on the first
	 * authenticated request, exactly as it does for a first Google login. The
	 * name field rides along as user_metadata so that provisioning picks it up
	 * instead of falling back to the email prefix.
	 */
	signup: async (event) => {
		if (!usesSupabaseAuth()) {
			return fail(400, { signupError: 'Sign-up is not available here.' });
		}

		const data = await event.request.formData();
		const name = (data.get('name') as string)?.trim();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;
		const redirectTo = data.get('redirectTo') as string | null;

		if (!name || !email || !password) {
			return fail(400, { signupError: 'Name, email and password are required.' });
		}

		// If email confirmation is on, the link in the mail lands back on the
		// OAuth callback route, which already exchanges the code for a session.
		const callback = new URL('/auth/callback', event.url.origin);
		if (redirectTo) callback.searchParams.set('next', redirectTo);

		const supabase = createSupabaseServerClient(event);
		const { data: result, error } = await supabase.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: callback.toString(), data: { full_name: name } }
		});

		if (error) {
			return fail(400, { signupError: error.message });
		}

		// Confirmation disabled: signUp returned a live session, so go straight in.
		if (result.session) {
			redirect(302, safeRedirect(redirectTo, event.url.origin));
		}

		// When the address is already registered, Supabase returns a placeholder
		// user with no identities instead of an error (so the endpoint can't be
		// used to enumerate accounts). Without this check the response below would
		// tell an existing user to watch for a confirmation mail that never comes.
		if (result.user?.identities?.length === 0) {
			return fail(400, {
				signupError: 'An account with this email already exists. Sign in instead.'
			});
		}

		return { signupPending: true };
	}
};
