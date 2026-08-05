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

		const redirectTo = event.url.searchParams.get('redirectTo');
		redirect(302, redirectTo ? decodeURIComponent(redirectTo) : '/');
	}
};
