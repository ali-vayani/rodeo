// Imported relatively rather than through `$lib` so this module stays usable from
// anywhere — including plain node scripts, which don't resolve SvelteKit aliases.
// The enums module, not the client barrel: this file is bundled for the browser
// (admin layout), and the barrel drags in the Node-only Prisma runtime.
import { Role } from '../generated/prisma/enums';

/**
 * Who can see what in the admin portal.
 *
 * ADMIN and ORGANIZER both get the portal shell, but they are not the same role.
 * An organizer is a mini-admin: they help run the event without seeing the people
 * in it. Anything holding real user data — the user table, admissions, mail, the
 * blacklist — is admin-only, as is the application editor, since that defines what
 * gets asked of applicants.
 *
 * This module is the single source of truth for that split. `hooks.server.ts` routes
 * with it, the tRPC procedures enforce with it, and the admin nav filters with it, so
 * a section can't be visible in one layer and denied in another.
 *
 * Note the nav is cosmetic: every page is backed by a tRPC procedure at /api/trpc/*,
 * so hiding a link proves nothing on its own. `adminProcedure` is the actual boundary
 * (see src/lib/server/trpc/init.ts) and it fails closed — endpoints an organizer may
 * call have to opt in to `portalProcedure`.
 */

export type AdminSection =
	| 'dashboard'
	| 'users'
	| 'admissions'
	| 'scan'
	| 'email'
	| 'application-editor'
	| 'schedule'
	| 'blacklist'
	| 'settings'
	| 'logs';

/** Everything an organizer may reach. Every other section is admin-only. */
export const ORGANIZER_SECTIONS: AdminSection[] = ['dashboard', 'scan', 'schedule'];

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
	email: ['/admin/email-templates', '/admin/custom-email'],
	'application-editor': ['/admin/application-editor'],
	schedule: ['/admin/schedule'],
	blacklist: ['/admin/blacklist'],
	settings: ['/admin/settings'],
	logs: ['/admin/logs']
};

export function isAdmin(roles: Role[]): boolean {
	return roles.includes(Role.ADMIN);
}

export function isOrganizer(roles: Role[]): boolean {
	return roles.includes(Role.ORGANIZER);
}

/** Can load the admin portal shell at all. */
export function hasPortalAccess(roles: Role[]): boolean {
	return isAdmin(roles) || isOrganizer(roles);
}

/**
 * Where an account belongs when no particular page was asked for.
 *
 * Used after login, on `/`, and by the dev account switcher. The rule was written out
 * by hand in each of those places; a third copy is what prompted extracting it, since
 * a landing page that disagrees between two of them is a bug nobody would think to
 * look for.
 */
export function homePathFor(roles: Role[]): string {
	return hasPortalAccess(roles) ? '/admin/dashboard' : '/hacker/application';
}

/**
 * Resolved by the strongest role held, so someone who is both ADMIN and ORGANIZER
 * gets the admin view rather than the intersection.
 */
export function canAccess(roles: Role[], section: AdminSection): boolean {
	if (isAdmin(roles)) return true;
	if (isOrganizer(roles)) return ORGANIZER_SECTIONS.includes(section);
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
 * Organizers are staff, not attendees — they have no application, so /hacker/* has
 * nothing to show them. Only organizers lose it: an admin's access is unchanged, and
 * someone who is genuinely also a HACKER keeps their own application.
 */
export function canAccessHackerPortal(roles: Role[]): boolean {
	if (roles.includes(Role.HACKER)) return true;
	// An admin keeps hacker-portal access even without the HACKER role; only a pure
	// organizer loses it. Without this, someone who is both ADMIN and ORGANIZER (but not
	// HACKER) was bounced out of /hacker/*, contradicting this function's own contract.
	if (isAdmin(roles)) return true;
	return !isOrganizer(roles);
}
