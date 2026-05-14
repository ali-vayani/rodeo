import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/server/supabase';

export const POST: RequestHandler = async (event) => {
	if (process.env.NODE_ENV === 'production') {
		const supabase = createSupabaseServerClient(event);
		await supabase.auth.signOut();
	} else {
		clearSessionCookie(event);
	}
	redirect(302, '/login');
};
