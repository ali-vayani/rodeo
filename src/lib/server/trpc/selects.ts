/**
 * Prisma `select` shapes shared across the tRPC routers.
 *
 * A `User` row carries `pendingDecision` and `claimedBy`/`claimedAt`, none of which may
 * reach a hacker, least of all a teammate's. Any `authedProcedure` endpoint returning
 * another user's record projects through one of these whitelists, never an `include`.
 */

import type { User } from '$lib/generated/prisma/client';

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

export type SelfUser = Pick<User, keyof typeof SELF_USER_SELECT>;

/**
 * Applies SELF_USER_SELECT to a row already in hand. Page loads hold the full
 * `locals.user`, and returning it whole serializes `pendingDecision` and the claim
 * columns into the page — this is the only shape a load may return.
 *
 * Inputs:
 * - user: User — a full row, typically `locals.user`
 *
 * Outputs:
 * - SelfUser — only the SELF_USER_SELECT columns
 */
export function toSelfUser(user: User): SelfUser {
	const keys = Object.keys(SELF_USER_SELECT) as (keyof typeof SELF_USER_SELECT)[];
	return Object.fromEntries(keys.map((key) => [key, user[key]])) as SelfUser;
}
