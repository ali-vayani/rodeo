import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { devSwitcherEnabled, usesSupabaseAuth } from '$lib/server/env';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { setSessionCookie, clearSessionCookie } from '$lib/server/auth';
import { homePathFor } from '$lib/auth/permissions';

/**
 * DEV ONLY. The backend for the account switcher widget.
 *
 * A passwordless login-as-any-account endpoint that works while signed out, so the gate
 * matters more than the feature. `devSwitcherEnabled()` is that gate, and every handler
 * calls `assertEnabled()` first.
 *
 * Outside `/admin/*` and `/hacker/*` deliberately: the hook treats an unmapped
 * `/admin/*` path as admin-only, which would make a signed-out switcher impossible.
 */

/**
 * The switcher's universe, matching what `/login`'s dev action already enforces, so
 * this endpoint grants no capability that door does not. It is also what makes
 * returning `pendingDecision` below defensible: these rows are only ever fixtures.
 */
const SEED_EMAIL_SUFFIX = '@yopmail.com';

/** A seeded database holds ~171 accounts. The ceiling is for a hand-grown one. */
const MAX_ACCOUNTS = 500;

/**
 * Deliberately not in `../trpc/selects.ts`, and deliberately including
 * `pendingDecision`, which that file exists to withhold. Which account sits on a
 * decided-but-unreleased application is the most common thing you open this widget to
 * check. Keeping it next to the embargo whitelist would invite reuse.
 */
const DEV_ACCOUNT_SELECT = {
	uid: true,
	name: true,
	email: true,
	role: true,
	status: true,
	activeDecision: true,
	pendingDecision: true
} as const;

/**
 * 404 in anything that is not `vite dev`: a deployed build must not confirm that a
 * passwordless-login endpoint lives here, even a disabled one. Inside a dev server the
 * gate can still be shut, and a bare 404 there is baffling.
 */
function assertEnabled(): void {
	if (devSwitcherEnabled()) return;
	if (dev) {
		error(403, 'Dev account switcher is off. It needs ALLOW_DEV_AUTH=1 and a local DATABASE_URL.');
	}
	error(404, 'Not found');
}

/**
 * On preview deploys a live Google session would shadow the switched account —
 * `getSession` checks Supabase before the bypass cookie — so becoming someone
 * ends it first. Development has no Supabase session to end.
 */
async function endSupabaseSession(event: RequestEvent): Promise<void> {
	if (!usesSupabaseAuth()) return;
	await createSupabaseServerClient(event).auth.signOut();
}

/**
 * Every seeded account, for the switcher panel to filter client-side.
 *
 * Unauthenticated on purpose, since the switcher's most useful moment is on `/login`.
 * That is safe only because of `assertEnabled()`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	assertEnabled();

	const accounts = await prisma.user.findMany({
		where: { email: { endsWith: SEED_EMAIL_SUFFIX } },
		select: DEV_ACCOUNT_SELECT,
		orderBy: { email: 'asc' },
		take: MAX_ACCOUNTS
	});

	return json({ accounts, currentUid: locals.user?.uid ?? null });
};

/**
 * Become another account, or sign out with `{ uid: null }`. Note what the body does not
 * carry: a redirect target. The destination comes from the account's own role, so
 * nothing here could become an open redirect.
 */
export const POST: RequestHandler = async (event) => {
	assertEnabled();

	// Login-CSRF. This endpoint sets a session cookie rather than reading one, so
	// SameSite=Lax protects nothing, and SvelteKit's own check only covers form-encodable
	// content types. Requiring JSON forces a preflight cross-origin.
	if (event.request.headers.get('content-type') !== 'application/json') {
		error(415, 'Expected application/json.');
	}
	const origin = event.request.headers.get('origin');
	if (origin !== null && origin !== event.url.origin) error(403, 'Cross-origin request.');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Expected a JSON body.');
	}

	const uid = (body as { uid?: unknown } | null)?.uid;

	// Being signed out is a state worth one click too — the widget is the only way to
	// reach it from a page with no sidebar.
	if (uid === null) {
		await endSupabaseSession(event);
		clearSessionCookie(event);
		return json({ redirectTo: '/login' });
	}

	if (typeof uid !== 'string' || !uid) {
		error(400, 'uid must be a string, or null to sign out.');
	}

	// Look the account up rather than writing the uid straight into the cookie. An
	// unknown value would read back as a null session and present as a mysterious logout.
	const user = await prisma.user.findUnique({
		where: { uid },
		select: { uid: true, email: true, name: true, role: true }
	});

	// The same 404 for "no such uid" and "not a seed account", so it is an oracle for
	// neither. The constraint is re-derived from the row.
	if (!user || !user.email.endsWith(SEED_EMAIL_SUFFIX)) error(404, 'No such account.');

	await endSupabaseSession(event);
	setSessionCookie(event, user.uid);

	// The dev server's terminal, not a Log row. /admin/logs is a product surface and
	// filling it with impersonation noise would degrade the real audit trail.
	console.info(`[dev-switcher] session → ${user.email} (${user.name})`);

	return json({ redirectTo: homePathFor(user.role) });
};
