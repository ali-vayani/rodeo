import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth } from '$lib/server/env';
import { Role } from '$lib/generated/prisma/client';

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
		// This cookie only exists on the dev bypass path, which never runs over
		// HTTPS; production sessions are Supabase's own cookies.
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

	// Find or create the local User record from the Supabase identity. Google is
	// the only sign-in path in production, so first login *is* registration —
	// there is no separate sign-up step that could have created this row.
	const email = sbUser.email.toLowerCase();
	const name = sbUser.user_metadata?.full_name ?? sbUser.user_metadata?.name ?? email.split('@')[0];

	// Upsert rather than find-then-create: two tabs finishing the OAuth handshake
	// at once would otherwise race on the unique email index and 500 one of them.
	return prisma.user.upsert({
		where: { email },
		update: {},
		// A brand-new account is a HACKER in CREATED — the state the application
		// page's "filling out" view expects. Roles are widened from /admin/users;
		// nothing about an OAuth profile can grant someone organizer access.
		create: { email, name, roles: [Role.HACKER] }
	});
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export async function getSession(event: RequestEvent) {
	return usesSupabaseAuth() ? getProdSession(event) : getDevSession(event);
}
