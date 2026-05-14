import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const next = event.url.searchParams.get('next') ?? '/';

	if (code) {
		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(302, next);
		}
	}

	redirect(302, '/login?error=oauth_failed');
};
