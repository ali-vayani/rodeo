import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { usesSupabaseAuth, yopmailLoginEnabled } from '$lib/server/env';
import { Role } from '$lib/generated/prisma/client';

const COOKIE_NAME = 'session_uid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

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

async function getProdSession(event: RequestEvent) {
	const supabase = createSupabaseServerClient(event);
	const {
		data: { user: sbUser }
	} = await supabase.auth.getUser();

	if (!sbUser?.email) return null;

	// Find or create the local User record from the Supabase identity. Either way first
	// login is registration: the sign-up form registers with Supabase only, so no earlier
	// step could have created this row.
	const email = sbUser.email.toLowerCase();
	const name = sbUser.user_metadata?.full_name ?? sbUser.user_metadata?.name ?? email.split('@')[0];

	// The common case, a returning user, is a read. This runs on every routed request, and
	// an unconditional upsert took a row-lock write per page view, contending with
	// admissions.claim/heartbeat. Only a first login falls through to the upsert, which
	// still resolves the two-tabs handshake race.
	const existing = await prisma.user.findUnique({ where: { email } });
	if (existing) return existing;

	return prisma.user.upsert({
		where: { email },
		update: {},
		// A brand-new account is a HACKER in CREATED, the state the application page's
		// "filling out" view expects. Nothing about an OAuth profile can grant staff access.
		create: { email, name, role: Role.HACKER }
	});
}

/**
 * Resolves the signed-in user for this request.
 *
 * Inputs:
 * - event: RequestEvent — supplies the cookies the session is read from
 *
 * Outputs:
 * - User | null — the local User row, or null when nobody is signed in
 *
 * Side effects:
 * - Creates the User row on a Supabase identity's first login.
 */
export async function getSession(event: RequestEvent) {
	if (!usesSupabaseAuth()) return getDevSession(event);

	const session = await getProdSession(event);
	if (session) return session;

	// Preview deploys also honor the yopmail bypass, but only for @yopmail.com accounts.
	// The cookie is a bare uid, and without this check a guessed uid would impersonate a
	// real Google-created account.
	if (!yopmailLoginEnabled()) return null;
	const devUser = await getDevSession(event);
	return devUser?.email.endsWith('@yopmail.com') ? devUser : null;
}
