import { describe, it, expect } from 'vitest';
import { Role } from '$lib/generated/prisma/client';
import {
	SECTION_PATHS,
	ORGANIZER_SECTIONS,
	canAccess,
	canAccessHackerPortal,
	hasPortalAccess,
	isAdmin,
	sectionForPath,
	type AdminSection
} from './permissions';

const ALL_SECTIONS = Object.keys(SECTION_PATHS) as AdminSection[];
const ADMIN_ONLY = ALL_SECTIONS.filter((s) => !ORGANIZER_SECTIONS.includes(s));

describe('portal access', () => {
	it('admits admins and organizers, nobody else', () => {
		expect(hasPortalAccess([Role.ADMIN])).toBe(true);
		expect(hasPortalAccess([Role.ORGANIZER])).toBe(true);
		expect(hasPortalAccess([Role.HACKER])).toBe(false);
		expect(hasPortalAccess([Role.VOLUNTEER, Role.JUDGE, Role.MENTOR])).toBe(false);
		expect(hasPortalAccess([])).toBe(false);
	});

	it('separates admin from organizer', () => {
		expect(isAdmin([Role.ADMIN])).toBe(true);
		expect(isAdmin([Role.ORGANIZER])).toBe(false);
	});
});

describe('canAccess', () => {
	it('gives admins every section', () => {
		for (const section of ALL_SECTIONS) {
			expect(canAccess([Role.ADMIN], section)).toBe(true);
		}
	});

	it('gives organizers exactly the organizer sections', () => {
		for (const section of ORGANIZER_SECTIONS) {
			expect(canAccess([Role.ORGANIZER], section)).toBe(true);
		}
		for (const section of ADMIN_ONLY) {
			expect(canAccess([Role.ORGANIZER], section)).toBe(false);
		}
	});

	it('keeps every section holding user data away from organizers', () => {
		// Spelled out rather than derived, so widening ORGANIZER_SECTIONS by accident
		// fails here instead of silently passing the loop above.
		for (const section of [
			'users',
			'admissions',
			'email',
			'blacklist',
			'settings',
			'application-editor'
		] as AdminSection[]) {
			expect(canAccess([Role.ORGANIZER], section)).toBe(false);
		}
	});

	it('resolves a dual-role user by their strongest role', () => {
		expect(canAccess([Role.ORGANIZER, Role.ADMIN], 'users')).toBe(true);
		expect(canAccess([Role.ADMIN, Role.ORGANIZER], 'settings')).toBe(true);
	});

	it('denies anyone outside the portal', () => {
		expect(canAccess([Role.HACKER], 'dashboard')).toBe(false);
		expect(canAccess([], 'dashboard')).toBe(false);
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
	it('shuts organizers out', () => {
		expect(canAccessHackerPortal([Role.ORGANIZER])).toBe(false);
	});

	it('leaves everyone else alone', () => {
		expect(canAccessHackerPortal([Role.HACKER])).toBe(true);
		expect(canAccessHackerPortal([Role.ADMIN])).toBe(true);
		expect(canAccessHackerPortal([Role.VOLUNTEER])).toBe(true);
	});

	it('lets an organizer who is genuinely also a hacker keep their application', () => {
		expect(canAccessHackerPortal([Role.ORGANIZER, Role.HACKER])).toBe(true);
	});
});
