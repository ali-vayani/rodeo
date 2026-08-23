/**
 * Prisma `select` shapes shared across the tRPC routers.
 *
 * A `User` row carries `pendingDecision` and `claimedBy`/`claimedAt`, none of which may
 * reach a hacker, least of all a teammate's. Any `authedProcedure` endpoint returning
 * another user's record projects through one of these whitelists, never an `include`.
 */

/**
 * What the account/team UI renders for someone other than the caller. Excludes status,
 * decisions, university, year, and the claim columns.
 */
export const TEAM_MEMBER_SELECT = {
	uid: true,
	name: true,
	email: true,
	role: true
} as const;

/**
 * The caller's own record for `user.me`. `activeDecision` is the released outcome the
 * account page shows; `pendingDecision` and the claim columns stay out.
 */
export const SELF_USER_SELECT = {
	uid: true,
	name: true,
	email: true,
	university: true,
	year: true,
	role: true,
	status: true,
	activeDecision: true,
	teamId: true,
	createdAt: true
} as const;
