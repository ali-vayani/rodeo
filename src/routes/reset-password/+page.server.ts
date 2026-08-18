import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth } from '$lib/server/env';

export const load: PageServerLoad = async ({ locals }) => {
	// Dev has no passwords to reset.
	if (!usesSupabaseAuth()) redirect(302, '/');

	// The recovery link signs the user in through /auth/callback before landing
	// here, so arriving anonymous means the link was expired, already used, or
	// opened in a different browser than the one that requested it (the code
	// exchange needs the PKCE verifier cookie from the requesting browser).
	if (!locals.user) redirect(302, '/login?error=reset_expired');
};

export const actions: Actions = {
	default: async (event) => {
		if (!usesSupabaseAuth()) {
			return fail(400, { error: 'Password reset is not available here.' });
		}

		const data = await event.request.formData();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!password) return fail(400, { error: 'Password is required.' });
		if (password !== confirm) return fail(400, { error: 'Passwords do not match.' });

		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.updateUser({ password });
		if (error) return fail(400, { error: error.message });

		// The recovery session is a full session, so the user is signed in —
		// `/` resolves the portal from their role.
		redirect(302, '/');
	}
};
