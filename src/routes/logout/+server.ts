import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth } from '$lib/server/env';

export const POST: RequestHandler = async (event) => {
	if (usesSupabaseAuth()) {
		const supabase = createSupabaseServerClient(event);
		await supabase.auth.signOut();
	}
	// Not an else: preview deploys carry Supabase auth AND the yopmail bypass
	// cookie, and a sign-out must end whichever session is live. Clearing a
	// cookie that was never set costs nothing in production.
	clearSessionCookie(event);
	redirect(302, '/login');
};
