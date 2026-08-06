// Imported relatively rather than through `$lib` so this module stays usable from
// anywhere — including plain node scripts, which don't resolve SvelteKit aliases.
// The enums module, not the client barrel: this file is bundled for the browser
// (admin layout), and the barrel drags in the Node-only Prisma runtime.
import { Role } from '../generated/prisma/enums';

/**
 * Who can see what, in both portals.
 *
 * Roles are mutually exclusive — a user holds exactly one (`User.role`) — and that
 * exclusivity is what makes the portal split total rather than approximate:
 *
 *   - Staff (ADMIN, ORGANIZER) live in /admin/* and cannot load /hacker/*. They have
 *     no application, no team and no QR code, so those pages have nothing to show them.
 *   - Everyone else (HACKER, JUDGE, MENTOR, VOLUNTEER, UNDECLARED) lives in /hacker/*
 *     and cannot load /admin/*.
 *
 * The two sets are disjoint and together they are exhaustive, so every account has
 * exactly one home and each portal denies the other's population outright. There is
 * no "strongest role wins" precedence anywhere in here anymore: with one role per
 * user there is nothing to break a tie between.
 *
 * Within the admin portal, ADMIN and ORGANIZER are still not the same role. An
 * organizer is a mini-admin: they help run the event without seeing the people in it.
 * Anything holding real user data — the user table, admissions, mail, the blacklist —
 * is admin-only, as is the application editor, since that defines what gets asked of
 * applicants.
 *
 * This module is the single source of truth for both splits. `hooks.server.ts` routes
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
 * Used after login, on `/`, by the dev account switcher, and by both portal guards as
 * the place to send someone they turn away. The rule was written out by hand in each
 * of those places; a third copy is what prompted extracting it, since a landing page
 * that disagrees between two of them is a bug nobody would think to look for.
 *
 * Total by construction: every role is either staff or not, so this always returns a
 * path the holder can actually load, and the two guards can never bounce someone back
 * and forth between portals.
 */
export function homePathFor(role: Role): string {
	return isStaff(role) ? '/admin/dashboard' : '/hacker/application';
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
 * Staff are not attendees — they have no application, no team and no QR code, so
 * /hacker/* has nothing to show them and they are turned away from all of it.
 *
 * Admins included, deliberately. An admin used to keep hacker-portal access as a
 * convenience, which meant the one account with the most authority was also the one
 * account living in both portals — exactly the ambiguity the exclusive-role model
 * exists to remove. An admin who needs to see what an applicant sees has
 * /admin/application-editor's preview pane for the form and /admin/users for the
 * person; neither requires borrowing an attendee's portal.
 *
 * The exact complement of `hasPortalAccess`, so the two guards partition every
 * account rather than merely overlapping.
 */
export function canAccessHackerPortal(role: Role): boolean {
	return !isStaff(role);
}
