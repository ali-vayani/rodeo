import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { setSessionCookie } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, '/');

	const isProd = process.env.NODE_ENV === 'production';
	const oauthError = url.searchParams.get('error');

	return {
		isProd,
		oauthError,
		supabaseUrl: isProd ? env.SUPABASE_URL : null,
		supabaseAnonKey: isProd ? env.SUPABASE_ANON_KEY : null
	};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;

		if (!email) return fail(400, { error: 'Email is required.' });

		if (process.env.NODE_ENV === 'production') {
			if (!password) return fail(400, { error: 'Password is required.' });

			const supabase = createSupabaseServerClient(event);
			const { error } = await supabase.auth.signInWithPassword({ email, password });

			if (error) {
				return fail(401, { error: 'Invalid email or password.' });
			}

			const redirectTo = event.url.searchParams.get('redirectTo');
			redirect(302, redirectTo ? decodeURIComponent(redirectTo) : '/');
		}

		// Dev: yopmail-only bypass
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
