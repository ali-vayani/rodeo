// Imported relatively rather than through `$lib` so prisma/seedUsers.ts can pull
// this in under tsx, which doesn't resolve SvelteKit's aliases. The enums module,
// not the client barrel: this file is bundled for the browser, and the barrel
// drags in the Node-only Prisma runtime (fileURLToPath at module load).
import { Role } from '../generated/prisma/enums';

/**
 * The roles that actually go through admissions.
 *
 * ADMIN and ORGANIZER accounts are provisioned directly by the team — they never
 * fill out an application, so there is nothing to review and they must not appear
 * in the queue. UNDECLARED is excluded for the opposite reason: that user has not
 * chosen a role yet, so there is no application to review either.
 *
 * This is the single source of truth for that rule. `admissions.list` uses it to
 * bound every query (including the "All" tab, which sends no role filter of its
 * own), and the seed uses it to decide who gets generated application responses —
 * so a staff account can't acquire an application in dev that production would
 * never produce.
 */
export const APPLICANT_ROLES: Role[] = [Role.HACKER, Role.JUDGE, Role.MENTOR, Role.VOLUNTEER];

/** True when this role goes through admissions. */
export function isApplicantRole(role: Role): boolean {
	return APPLICANT_ROLES.includes(role);
}

/**
 * Narrow a requested role filter to the applicant set.
 *
 * Returns `APPLICANT_ROLES` when nothing was requested, so "no filter" means "every
 * applicant" rather than "every user". An explicit request for only staff roles
 * narrows to nothing, which is the honest answer — those accounts have no
 * application — and callers must treat an empty result as "match no one".
 */
export function narrowToApplicants(requested?: Role[]): Role[] {
	if (!requested?.length) return APPLICANT_ROLES;
	return requested.filter((r) => APPLICANT_ROLES.includes(r));
}
