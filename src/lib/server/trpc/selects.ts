/**
 * Prisma `select` shapes shared across the tRPC routers.
 *
 * The point of keeping these in one place is the decision embargo. A `User` row carries
 * `pendingDecision` plus `claimedBy`/`claimedAt`, none of which may reach a hacker, and
 * above all not a teammate's. So any `authedProcedure` endpoint returning another
 * user's record projects through a whitelist rather than an `include`.
 */

/**
 * The only fields the account/team UI renders for someone other than the caller: an
 * avatar, the address the invite was sent to, and the role tag. Deliberately excludes
 * status, decisions, university, year, and the claim columns.
 */
export const TEAM_MEMBER_SELECT = {
	uid: true,
	name: true,
	email: true,
	role: true
} as const;

/**
 * The caller's own record for `user.me`. Includes `status` and `activeDecision`, the
 * released outcome the account page legitimately shows, but not `pendingDecision` or
 * the claim columns.
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
