import type { Cookies } from '@sveltejs/kit';

/**
 * Remembering a team invite link.
 *
 * The invite arrives as `?join=<code>` on one page, so without this, navigating
 * anywhere else dropped it. A cookie rather than a store because the banner is
 * server-rendered from a layout load: it has to survive a full document load and be
 * readable during SSR.
 */
export const INVITE_COOKIE = 'rodeo_team_invite';

/** A week. Long enough to cover clicking the link and RSVPing days later, which is
    the case this exists for, since you cannot join a team until you have confirmed. */
const MAX_AGE = 60 * 60 * 24 * 7;

/** `httpOnly` even though the code is not a secret: nothing in the browser reads it. */
export function rememberInvite(cookies: Cookies, inviteCode: string): void {
	cookies.set(INVITE_COOKIE, inviteCode, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE,
		secure: false
	});
}

export function readInvite(cookies: Cookies): string | null {
	return cookies.get(INVITE_COOKIE) || null;
}

export function forgetInvite(cookies: Cookies): void {
	cookies.delete(INVITE_COOKIE, { path: '/' });
}
