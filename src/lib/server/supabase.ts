import { createServerClient } from '@supabase/ssr';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export function createSupabaseServerClient(event: RequestEvent) {
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_ANON_KEY;

	if (!url || !key) {
		throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in production');
	}

	return createServerClient(url, key, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});
}
