import { describe, it, expect } from 'vitest';
import { Role } from '$lib/generated/prisma/client';
import {
	SECTION_PATHS,
	ORGANIZER_SECTIONS,
	STAFF_ROLES,
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	homePathFor,
	isAdmin,
	isStaff,
	sectionForPath,
	type AdminSection
} from './permissions';

const ALL_SECTIONS = Object.keys(SECTION_PATHS) as AdminSection[];
const ADMIN_ONLY = ALL_SECTIONS.filter((s) => !ORGANIZER_SECTIONS.includes(s));
const ALL_ROLES = Object.values(Role);

describe('portal access', () => {
	it('admits admins and organizers, nobody else', () => {
		expect(hasPortalAccess(Role.ADMIN)).toBe(true);
		expect(hasPortalAccess(Role.ORGANIZER)).toBe(true);
		expect(hasPortalAccess(Role.HACKER)).toBe(false);
		expect(hasPortalAccess(Role.VOLUNTEER)).toBe(false);
		expect(hasPortalAccess(Role.JUDGE)).toBe(false);
		expect(hasPortalAccess(Role.MENTOR)).toBe(false);
		expect(hasPortalAccess(Role.UNDECLARED)).toBe(false);
	});

	it('separates admin from organizer', () => {
		expect(isAdmin(Role.ADMIN)).toBe(true);
		expect(isAdmin(Role.ORGANIZER)).toBe(false);
	});

	it('agrees with STAFF_ROLES for every role', () => {
		// The constant and the predicate are read by different layers — the users page
		// warns off it, the guards test it — so a role added to one and not the other
		// would let the UI promise access the guard denies.
		for (const role of ALL_ROLES) {
			expect(isStaff(role)).toBe(STAFF_ROLES.includes(role));
		}
	});
});

describe('the two portals partition every role', () => {
	// The property the exclusive-role model exists to provide: each account belongs to
	// exactly one portal. Asserted over `Object.values(Role)` rather than a hand-written
	// list, so a role added to the enum without a decision about where it lives fails here.
	it('gives every role exactly one portal — never both, never neither', () => {
		for (const role of ALL_ROLES) {
			const portals = [hasPortalAccess(role), canAccessHackerPortal(role)].filter(Boolean);
			expect(portals, `${role} should hold exactly one portal`).toHaveLength(1);
		}
	});

	it('sends every role home to the portal it can actually load', () => {
		for (const role of ALL_ROLES) {
			const home = homePathFor(role);
			if (home.startsWith('/admin/')) {
				expect(hasPortalAccess(role)).toBe(true);
				expect(canAccess(role, 'dashboard')).toBe(true);
			} else {
				expect(canAccessHackerPortal(role)).toBe(true);
			}
		}
	});

	it('never redirects a role into a portal that bounces it back', () => {
		// Both guards send a rejected user to `homePathFor`, so if that destination were
		// itself guarded against them the two would ping-pong until the browser gave up.
		for (const role of ALL_ROLES) {
			const home = homePathFor(role);
			const bouncedAgain = home.startsWith('/admin/')
				? !hasPortalAccess(role)
				: !canAccessHackerPortal(role);
			expect(bouncedAgain, `${role} would redirect-loop at ${home}`).toBe(false);
		}
	});
});

describe('canAccess', () => {
	it('gives admins every section', () => {
		for (const section of ALL_SECTIONS) {
			expect(canAccess(Role.ADMIN, section)).toBe(true);
		}
	});

	it('gives organizers exactly the organizer sections', () => {
		for (const section of ORGANIZER_SECTIONS) {
			expect(canAccess(Role.ORGANIZER, section)).toBe(true);
		}
		for (const section of ADMIN_ONLY) {
			expect(canAccess(Role.ORGANIZER, section)).toBe(false);
		}
	});

	it('keeps every section holding user data away from organizers', () => {
		// Spelled out rather than derived, so widening ORGANIZER_SECTIONS by accident
		// fails here instead of silently passing the loop above. Admissions is the
		// deliberate exception: organizers review applications.
		for (const section of [
			'users',
			'email',
			'blacklist',
			'settings',
			'application-editor'
		] as AdminSection[]) {
			expect(canAccess(Role.ORGANIZER, section)).toBe(false);
		}
	});

	it('denies every non-staff role every section', () => {
		for (const role of ALL_ROLES.filter((r) => !STAFF_ROLES.includes(r))) {
			for (const section of ALL_SECTIONS) {
				expect(canAccess(role, section)).toBe(false);
			}
		}
	});
});

describe('sectionForPath', () => {
	it('maps every declared path to its section', () => {
		for (const [section, paths] of Object.entries(SECTION_PATHS)) {
			for (const path of paths) {
				expect(sectionForPath(path)).toBe(section);
			}
		}
	});

	it('treats both email routes as one permission', () => {
		expect(sectionForPath('/admin/email-templates')).toBe('email');
		expect(sectionForPath('/admin/custom-email')).toBe('email');
	});

	it('matches nested routes under a section', () => {
		expect(sectionForPath('/admin/users/abc123')).toBe('users');
	});

	it('returns null for paths it does not own', () => {
		expect(sectionForPath('/hacker/application')).toBeNull();
		expect(sectionForPath('/admin')).toBeNull();
		// Guards against a prefix match swallowing an unrelated future route.
		expect(sectionForPath('/admin/users-export')).toBeNull();
	});
});

describe('canAccessHackerPortal', () => {
	it('shuts staff out — admins included', () => {
		expect(canAccessHackerPortal(Role.ORGANIZER)).toBe(false);
		// The change that motivated the exclusive-role model: an admin used to keep
		// hacker-portal access, which put one account in both portals at once.
		expect(canAccessHackerPortal(Role.ADMIN)).toBe(false);
	});

	it('admits every attendee role', () => {
		expect(canAccessHackerPortal(Role.HACKER)).toBe(true);
		expect(canAccessHackerPortal(Role.JUDGE)).toBe(true);
		expect(canAccessHackerPortal(Role.MENTOR)).toBe(true);
		expect(canAccessHackerPortal(Role.VOLUNTEER)).toBe(true);
		// Not yet declared is still not staff, and the application page is where they
		// go to declare — so they must be able to load it.
		expect(canAccessHackerPortal(Role.UNDECLARED)).toBe(true);
	});
});

describe('homePathFor', () => {
	it('sends staff to the dashboard', () => {
		expect(homePathFor(Role.ADMIN)).toBe('/admin/dashboard');
		expect(homePathFor(Role.ORGANIZER)).toBe('/admin/dashboard');
	});

	it('sends everyone else to the portal home', () => {
		expect(homePathFor(Role.HACKER)).toBe('/hacker');
		expect(homePathFor(Role.JUDGE)).toBe('/hacker');
		expect(homePathFor(Role.MENTOR)).toBe('/hacker');
		expect(homePathFor(Role.VOLUNTEER)).toBe('/hacker');
		expect(homePathFor(Role.UNDECLARED)).toBe('/hacker');
	});
});
