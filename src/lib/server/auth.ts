import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth, yopmailLoginEnabled } from '$lib/server/env';
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
		// The bypass runs on plain-HTTP localhost and on HTTPS preview deploys;
		// production sessions are Supabase's own cookies.
		secure: event.url.protocol === 'https:'
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

	// The common case — a returning user — is a read: this runs on every routed request
	// via hooks, and an unconditional upsert took a row-lock write per page view,
	// contending with admissions.claim/heartbeat on the same rows. Only a first login
	// falls through to the upsert, which still resolves the two-tabs handshake race (both
	// tabs would otherwise collide on the unique email index and 500 one).
	const existing = await prisma.user.findUnique({ where: { email } });
	if (existing) return existing;

	return prisma.user.upsert({
		where: { email },
		update: {},
		// A brand-new account is a HACKER in CREATED — the state the application
		// page's "filling out" view expects. The role is changed from /admin/users;
		// nothing about an OAuth profile can grant someone staff access.
		create: { email, name, role: Role.HACKER }
	});
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export async function getSession(event: RequestEvent) {
	if (!usesSupabaseAuth()) return getDevSession(event);

	const session = await getProdSession(event);
	if (session) return session;

	// Preview deploys also honor the yopmail bypass (see yopmailLoginEnabled for
	// why that is safe there), but only for @yopmail.com accounts: the cookie is
	// a bare uid, and without this check a guessed uid would impersonate a real
	// Google-created account — seeded fixtures are fair game, people are not.
	if (!yopmailLoginEnabled()) return null;
	const devUser = await getDevSession(event);
	return devUser?.email.endsWith('@yopmail.com') ? devUser : null;
}
