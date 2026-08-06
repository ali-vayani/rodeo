import type { LayoutServerLoad } from './$types';
import { createCallerFactory } from '$lib/server/trpc/init';
import { appRouter } from '$lib/server/trpc/router';
import { createContext } from '$lib/server/trpc/context';
import { forgetInvite, readInvite, rememberInvite } from '$lib/server/invite';
import { teamIneligibility } from '$lib/team/eligibility';

const createCaller = createCallerFactory(appRouter);

/**
 * Resolves a pending team invitation for the whole hacker portal.
 *
 * In the layout rather than in `application/+page.server.ts` — where it used to
 * live — so the banner follows you across `/hacker/*` instead of vanishing the
 * moment you leave the page you happened to land on. The `?join=` param is copied
 * into a cookie on first sight, which is what lets it survive both the navigation
 * and the RSVP round trip that has to happen before you are allowed to join at all.
 */
export const load: LayoutServerLoad = async (event) => {
	const fromUrl = event.url.searchParams.get('join')?.trim();
	if (fromUrl) rememberInvite(event.cookies, fromUrl);

	const inviteCode = fromUrl || readInvite(event.cookies);
	if (!inviteCode) return { invite: null };

	// Non-null for the same reason the page loads assert it: `hooks.server.ts`
	// redirects an unauthenticated request before any /hacker/* load runs.
	const user = event.locals.user!;

	// Already on a team — the invitation can no longer do anything, and the code has
	// no second use. Dropped here rather than left for `joinByCode` to refuse, so a
	// spent invite stops re-rendering a banner on every page.
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
			 * The same call the router makes — see $lib/team/eligibility. This used to be
			 * a hand-copied version of the status half of that rule, which is how a judge
			 * or a mentor holding a copied link got a live Join button: they clear the
			 * accept/confirm funnel like anyone else, and nothing here looked at the role.
			 *
			 * Surfaced rather than used to hide the banner: an invite clicked before
			 * RSVPing is the common case, and silently showing nothing is what made the
			 * link feel broken. The banner explains why instead, and in the one case that
			 * resolves itself — a pending RSVP — the button lights up once it lands.
			 */
			ineligibility: teamIneligibility(user)
		}
	};
};
