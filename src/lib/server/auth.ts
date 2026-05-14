import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createSupabaseServerClient } from '$lib/server/supabase';

const COOKIE_NAME = 'session_uid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// ---------------------------------------------------------------------------
// Dev auth (yopmail only)
// ---------------------------------------------------------------------------

async function getDevSession(event: RequestEvent) {
	const uid = event.cookies.get(COOKIE_NAME);
	if (!uid) return null;
	return prisma.user.findUnique({ where: { uid } });
}

export function setSessionCookie(event: RequestEvent, uid: string) {
	event.cookies.set(COOKIE_NAME, uid, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE,
		secure: false
	});
}

export function clearSessionCookie(event: RequestEvent) {
	event.cookies.delete(COOKIE_NAME, { path: '/' });
}

// ---------------------------------------------------------------------------
// Production auth (Supabase JWT)
// ---------------------------------------------------------------------------

async function getProdSession(event: RequestEvent) {
	const supabase = createSupabaseServerClient(event);
	const {
		data: { user: sbUser }
	} = await supabase.auth.getUser();

	if (!sbUser?.email) return null;

	// Find or create the local User record from the Supabase identity
	let user = await prisma.user.findUnique({ where: { email: sbUser.email } });

	if (!user) {
		const name =
			sbUser.user_metadata?.full_name ??
			sbUser.user_metadata?.name ??
			sbUser.email.split('@')[0];

		user = await prisma.user.create({
			data: { email: sbUser.email, name }
		});
	}

	return user;
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export async function getSession(event: RequestEvent) {
	if (process.env.NODE_ENV === 'production') {
		return getProdSession(event);
	}
	return getDevSession(event);
}
