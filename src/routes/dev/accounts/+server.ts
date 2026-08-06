import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { devSwitcherEnabled } from '$lib/server/env';
import { setSessionCookie, clearSessionCookie } from '$lib/server/auth';
import { homePathFor } from '$lib/auth/permissions';

/**
 * DEV ONLY — the backend for the account switcher widget.
 *
 * Deleting this directory and `src/lib/dev` removes the feature entirely.
 *
 * This is a passwordless login-as-any-account endpoint that works while signed out,
 * so the gate matters more than the feature does. `devSwitcherEnabled()` in
 * `$lib/server/env` is that gate and carries the reasoning; every handler here calls
 * `assertEnabled()` on its first line.
 *
 * It lives outside `/admin/*` and `/hacker/*` deliberately. `hooks.server.ts` guards
 * those two prefixes and treats an unmapped `/admin/*` path as admin-only, which
 * would make a switcher that must work signed out impossible. Guarding here rather
 * than adding a prefix to the hook follows `src/routes/design/+page.server.ts`: the
 * rule protects exactly one route and is easier to trust sitting next to it.
 */

/**
 * The switcher's universe, matching the constraint `/login`'s dev action already
 * enforces. That is the point rather than an accident: applying the identical filter
 * means this endpoint grants no capability that door does not already grant, so
 * reviewing it is one question instead of two. It is also what makes returning
 * `pendingDecision` below defensible — the only rows this can ever describe are seed
 * fixtures, never a real applicant.
 */
const SEED_EMAIL_SUFFIX = '@yopmail.com';

/** A seeded database holds ~171 accounts. The ceiling is for a hand-grown one. */
const MAX_ACCOUNTS = 500;

/**
 * Deliberately not in `$lib/server/trpc/selects.ts`, and deliberately including
 * `pendingDecision`, which that file exists to withhold.
 *
 * Which account is sitting on a decided-but-unreleased application is the single most
 * common thing you open this widget to check, and there is nowhere else to see it
 * short of Prisma Studio. Keeping an embargo-breaking projection next to the embargo
 * whitelist would be an invitation to reuse it, so it lives here, behind the gate,
 * and must not move.
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
 * 404 in anything that is not `vite dev` — a deployed build must not confirm that a
 * passwordless-login endpoint lives at this path, even a disabled one. The same
 * reasoning, and the same choice of 404 over 403, as the `/design` guard.
 *
 * Inside a dev server the gate can still be shut (no `ALLOW_DEV_AUTH`, a remote
 * `DATABASE_URL`), and a bare 404 there is baffling — confusing errors are how safety
 * rails get ripped out. `dev` is a build-time constant, so this explanatory branch
 * does not exist in a built bundle.
 */
function assertEnabled(): void {
	if (devSwitcherEnabled()) return;
	if (dev) {
		error(403, 'Dev account switcher is off. It needs ALLOW_DEV_AUTH=1 and a local DATABASE_URL.');
	}
	error(404, 'Not found');
}

/**
 * Every seeded account, for the switcher panel to filter client-side.
 *
 * Unauthenticated on purpose: the switcher's most useful moment is on `/login` while
 * signed out, so there is no session to check. That is safe only because of
 * `assertEnabled()` — if the gate is ever weakened, this enumerates every user's
 * email, status and decision. It is the line to look at first in review.
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
 * Become another account, or sign out with `{ uid: null }`.
 *
 * Note what the body does *not* carry: a redirect target. The destination is derived
 * from the account's own roles, so unlike `/login` — whose `?redirectTo` crosses the
 * trust boundary and needs `safeRedirect` — there is nothing here that could become
 * an open redirect.
 */
export const POST: RequestHandler = async (event) => {
	assertEnabled();

	// Login-CSRF. This endpoint *sets* a session cookie rather than reading one, so
	// SameSite=Lax protects nothing, and SvelteKit's own CSRF check only covers the
	// form-encodable content types. Requiring JSON forces a preflight cross-origin,
	// and the Origin check closes the rest. Cheap, and this is a login primitive.
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
		clearSessionCookie(event);
		return json({ redirectTo: '/login' });
	}

	if (typeof uid !== 'string' || !uid) {
		error(400, 'uid must be a string, or null to sign out.');
	}

	// Look the account up rather than writing the uid straight into the cookie: an
	// unknown value would read back as a null session on every later request, which
	// presents as a mysterious logout rather than as the typo it is.
	const user = await prisma.user.findUnique({
		where: { uid },
		select: { uid: true, email: true, name: true, role: true }
	});

	// The same 404 for "no such uid" and "not a seed account", so it is an oracle for
	// neither. The constraint is re-derived from the row; a client-sent email would
	// be worthless here.
	if (!user || !user.email.endsWith(SEED_EMAIL_SUFFIX)) error(404, 'No such account.');

	setSessionCookie(event, user.uid);

	// The dev server's terminal, not a Log row. /admin/logs is a product surface and
	// filling it with impersonation noise would degrade the real audit trail.
	console.info(`[dev-switcher] session → ${user.email} (${user.name})`);

	return json({ redirectTo: homePathFor(user.role) });
};
