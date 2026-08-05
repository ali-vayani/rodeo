import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth } from '$lib/server/env';

export const POST: RequestHandler = async (event) => {
	if (usesSupabaseAuth()) {
		const supabase = createSupabaseServerClient(event);
		await supabase.auth.signOut();
	} else {
		clearSessionCookie(event);
	}
	redirect(302, '/login');
};
