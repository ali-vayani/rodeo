import { Role } from '../generated/prisma/enums';

export const APPLICANT_ROLES: Role[] = [Role.HACKER, Role.JUDGE, Role.MENTOR, Role.VOLUNTEER];

export function isApplicantRole(role: Role): boolean {
	return APPLICANT_ROLES.includes(role);
}

/**
 * Restricts a role filter to the applicant roles, so an admissions query can never
 * return staff. An empty or missing filter means every applicant role.
 */
export function narrowToApplicants(requested?: Role[]): Role[] {
	if (!requested?.length) return APPLICANT_ROLES;
	return requested.filter((r) => APPLICANT_ROLES.includes(r));
}
