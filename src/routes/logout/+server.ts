import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth';

export const POST: RequestHandler = (event) => {
	clearSessionCookie(event);
	redirect(302, '/login');
};
