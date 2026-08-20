import { Role } from '../generated/prisma/enums';

export const APPLICANT_ROLES: Role[] = [Role.HACKER, Role.JUDGE, Role.MENTOR, Role.VOLUNTEER];

export function isApplicantRole(role: Role): boolean {
	return APPLICANT_ROLES.includes(role);
}

/**
 * Narrow a requested role filter to the applicant set.
 */
export function narrowToApplicants(requested?: Role[]): Role[] {
	if (!requested?.length) return APPLICANT_ROLES;
	return requested.filter((r) => APPLICANT_ROLES.includes(r));
}
