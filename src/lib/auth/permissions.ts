// Imported relatively rather than through `$lib` so plain node scripts, which do not
// resolve SvelteKit aliases, can use this too. The enums module, not the client barrel:
// this file is bundled for the browser and the barrel drags in the Prisma runtime.
import { Role } from '../generated/prisma/enums';

/**
 * Who can see what, in both portals.
 *
 * Roles are mutually exclusive, which makes the portal split total rather than
 * approximate. Staff live in /admin/* and cannot load /hacker/*, having no application,
 * team or QR code; everyone else is the reverse. The two sets are disjoint and
 * exhaustive, so every account has exactly one home.
 *
 * Within the admin portal, an organizer helps run the event and reviews applications,
 * but every other section holding real user data is admin-only.
 *
 * This module is the single source of truth for both splits. The nav is cosmetic;
 * `adminProcedure` is the actual boundary and it fails closed.
 */

export type AdminSection =
	| 'dashboard'
	| 'users'
	| 'admissions'
	| 'scan'
	| 'walkin'
	| 'email'
	| 'application-editor'
	| 'schedule'
	| 'projects'
	| 'blacklist'
	| 'settings'
	| 'logs';

/**
 * Everything an organizer may reach. Every other section is admin-only.
 *
 * `walkin`, like `scan`, is event-day desk work: it exposes only name, email and
 * status — never applications or decisions.
 */
export const ORGANIZER_SECTIONS: AdminSection[] = [
	'dashboard',
	'admissions',
	'scan',
	'walkin',
	'schedule',
	'projects'
];

/**
 * Route prefixes per section, used both to guard requests and to filter the nav —
 * one mapping, so a link can't point somewhere the guard rejects.
 *
 * `email` covers two routes because the templates page and the custom-email wizard
 * are one permission, not two.
 */
export const SECTION_PATHS: Record<AdminSection, string[]> = {
	dashboard: ['/admin/dashboard'],
	users: ['/admin/users'],
	admissions: ['/admin/admissions'],
	scan: ['/admin/scan'],
	walkin: ['/admin/walkin'],
	email: ['/admin/email-templates', '/admin/custom-email'],
	'application-editor': ['/admin/application-editor'],
	schedule: ['/admin/schedule'],
	projects: ['/admin/projects'],
	blacklist: ['/admin/blacklist'],
	settings: ['/admin/settings'],
	logs: ['/admin/logs']
};

/** The roles that run the event. Disjoint from `APPLICANT_ROLES` by construction. */
export const STAFF_ROLES: Role[] = [Role.ADMIN, Role.ORGANIZER];

export function isAdmin(role: Role): boolean {
	return role === Role.ADMIN;
}

export function isOrganizer(role: Role): boolean {
	return role === Role.ORGANIZER;
}

/** Staff, i.e. the admin-portal population. The complement is the hacker portal's. */
export function isStaff(role: Role): boolean {
	return isAdmin(role) || isOrganizer(role);
}

/** Can load the admin portal shell at all. */
export function hasPortalAccess(role: Role): boolean {
	return isStaff(role);
}

/**
 * Where an account belongs when no particular page was asked for.
 *
 * Used after login, on `/`, by the dev switcher, and by both portal guards as the place
 * to send someone they turn away. Total by construction, so the two guards can never
 * bounce someone between portals.
 */
export function homePathFor(role: Role): string {
	return isStaff(role) ? '/admin/dashboard' : '/hacker';
}

export function canAccess(role: Role, section: AdminSection): boolean {
	if (isAdmin(role)) return true;
	if (isOrganizer(role)) return ORGANIZER_SECTIONS.includes(section);
	return false;
}

/** The section a pathname belongs to, or null if it isn't a guarded admin route. */
export function sectionForPath(pathname: string): AdminSection | null {
	for (const [section, paths] of Object.entries(SECTION_PATHS)) {
		if (paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
			return section as AdminSection;
		}
	}
	return null;
}

/**
 * Staff are not attendees, so /hacker/* has nothing to show them.
 *
 * Admins included, deliberately: keeping hacker-portal access as a convenience meant
 * the account with the most authority lived in both portals. The exact complement of
 * `hasPortalAccess`, so the two guards partition every account.
 */
export function canAccessHackerPortal(role: Role): boolean {
	return !isStaff(role);
}
