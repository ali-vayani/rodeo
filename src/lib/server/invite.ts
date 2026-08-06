import type { Cookies } from '@sveltejs/kit';

/**
 * Remembering a team invite link.
 *
 * The invite arrives as `?join=<code>` on `/hacker/application`, and that is the only
 * place it existed: the banner was rendered from the page's own load, so navigating to
 * `/hacker/account` — the page with the team panel on it, the obvious next click —
 * dropped the invitation on the floor with no way back but the original link.
 *
 * A cookie rather than a store or a session table because the banner is server-rendered
 * from a layout load. It has to survive a full document load (which rules out component
 * state) and be readable during SSR (which rules out sessionStorage), and it holds one
 * short public code that is already in the URL of a link people paste into group chats.
 */
export const INVITE_COOKIE = 'rodeo_team_invite';

/**
 * A week. Long enough to cover "clicked the link, then RSVP'd a few days later" —
 * which is the case this exists for, since you cannot join a team until you have
 * confirmed — and short enough that a stale code doesn't follow someone to the
 * next event.
 */
const MAX_AGE = 60 * 60 * 24 * 7;

/**
 * `httpOnly` even though the code is not a secret: nothing in the browser needs to read
 * it (the layout load resolves the team server-side and hands the component a name and
 * a count), so there is no reason to widen it. Cleared through the `/hacker/invite`
 * endpoint instead.
 */
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
