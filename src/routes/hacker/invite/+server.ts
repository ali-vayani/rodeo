import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { forgetInvite } from '$lib/server/invite';

/**
 * Drops the remembered team invitation.
 *
 * Exists because the cookie is `httpOnly` and the banner lives in a layout, which
 * cannot own a form action. Called when the banner is dismissed and after a successful
 * join.
 *
 * `hooks.server.ts` already guards every `/hacker/*` path, and the only thing this can
 * do is delete the caller's own cookie.
 */
export const DELETE: RequestHandler = (event) => {
	forgetInvite(event.cookies);
	return json({ ok: true });
};
