/**
 * Prisma `select` shapes shared across the tRPC routers.
 *
 * The point of keeping these in one place is the decision embargo. A `User` row
 * carries `pendingDecision` (unreleased, set by admissions before `release`) plus
 * `claimedBy`/`claimedAt` (which admin is reviewing whom). None of that may reach a
 * hacker — not their own, and above all not a teammate's — so any endpoint on
 * `authedProcedure` that returns another user's record has to project through a
 * whitelist rather than an `include`, which would hand back every scalar.
 */

/**
 * The only fields the account/team UI renders for someone *other* than the caller:
 * an avatar (name/initials), the address the invite was sent to, and the role tag.
 * Deliberately excludes status, decisions, university, year, and the claim columns.
 */
export const TEAM_MEMBER_SELECT = {
	uid: true,
	name: true,
	email: true,
	role: true
} as const;

/**
 * The caller's own record for `user.me`. Includes `status` and `activeDecision`
 * (the released outcome the account page legitimately shows the applicant) but not
 * `pendingDecision` or the claim columns — an applicant must not be able to read
 * their fate out of the network response before organizers release it.
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
