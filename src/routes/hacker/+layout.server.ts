import type { LayoutServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { forgetInvite, readInvite, rememberInvite } from '$lib/server/invite';
import { teamIneligibility } from '$lib/team/eligibility';

const createCaller = createCallerFactory(appRouter);

/**
 * Resolves a pending team invitation for the whole hacker portal, so the banner follows
 * you across `/hacker/*`. The `?join=` param is copied into a cookie on first sight,
 * which is what lets it survive the RSVP round trip that must happen before joining.
 */
export const load: LayoutServerLoad = async (event) => {
	const fromUrl = event.url.searchParams.get('join')?.trim();
	if (fromUrl) rememberInvite(event.cookies, fromUrl);

	const inviteCode = fromUrl || readInvite(event.cookies);
	if (!inviteCode) return { invite: null };

	// Non-null for the same reason the page loads assert it: `hooks.server.ts`
	// redirects an unauthenticated request before any /hacker/* load runs.
	const user = event.locals.user!;

	// Already on a team, so the invitation can no longer do anything. Dropped here rather
	// than left for `joinByCode` to refuse, so a spent invite stops re-rendering a banner.
	if (user.teamId) {
		forgetInvite(event.cookies);
		return { invite: null };
	}

	const caller = createCaller(createContext(event));
	const team = await caller.team.getByInviteCode({ inviteCode });

	// Expired, revoked, or a mistyped code. Same treatment: forget it, so a bad link
	// doesn't leave a permanently broken banner overhead.
	if (!team) {
		forgetInvite(event.cookies);
		return { invite: null };
	}

	return {
		invite: {
			...team,
			/**
			 * The same call the router makes. This used to be a hand-copied version of the
			 * status half of that rule, which is how a judge holding a copied link got a
			 * live Join button.
			 *
			 * Surfaced rather than used to hide the banner: an invite clicked before RSVPing
			 * is the common case, and showing nothing is what made the link feel broken.
			 */
			ineligibility: teamIneligibility(user)
		}
	};
};
