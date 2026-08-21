import { describe, it, expect, vi } from 'vitest';

// Loaded for MAX_UPLOAD_BYTES only; the S3 client is never built.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { Role, UserStatus } from '$lib/generated/prisma/client';
import { MAX_UPLOAD_BYTES } from './s3';
import {
	applicationFileKey,
	canDownloadApplicationFile,
	checkUpload,
	uploadRefusal
} from './applicationFiles';

describe('applicationFileKey', () => {
	it('namespaces application files under their own prefix', () => {
		// One bucket also holds wallet artwork under `ticket.pass/`.
		expect(applicationFileKey('user1', 'q1')).toBe('applications/user1/q1');
	});

	it('is derived, so the same answer always maps to the same object', () => {
		// What makes re-uploading an overwrite rather than a leak.
		expect(applicationFileKey('u', 'q')).toBe(applicationFileKey('u', 'q'));
	});
});

describe('checkUpload', () => {
	it('accepts an ordinary file', () => {
		expect(checkUpload({ size: 250_000, name: 'resume.pdf' })).toBeNull();
	});

	it('rejects an empty file', () => {
		// What some browsers yield for a cancelled pick.
		expect(checkUpload({ size: 0, name: 'resume.pdf' })?.status).toBe(400);
	});

	it('rejects a file over the limit, and says how big it was', () => {
		const rejection = checkUpload({ size: MAX_UPLOAD_BYTES + 1, name: 'resume.pdf' });
		expect(rejection?.status).toBe(413);
		expect(rejection?.message).toMatch(/4\.0 MB/);
		expect(rejection?.message).toMatch(/limit is 4 MB/);
	});

	it('accepts a file exactly at the limit', () => {
		expect(checkUpload({ size: MAX_UPLOAD_BYTES, name: 'resume.pdf' })).toBeNull();
	});

	it('rejects a file with a blank name', () => {
		expect(checkUpload({ size: 100, name: '   ' })?.status).toBe(400);
	});

	it('does not filter by content type', () => {
		// Downloads are attachments, so an unexpected type is harmless.
		expect(checkUpload({ size: 100, name: 'portfolio.sketch' })).toBeNull();
	});
});

describe('uploadRefusal', () => {
	const question = { targetRole: [] as Role[] };

	it('allows an applicant still filling their application in', () => {
		const user = { uid: 'u', status: UserStatus.CREATED, role: Role.HACKER };
		expect(uploadRefusal(user, question)).toBeNull();
	});

	it('refuses once the application has been submitted', () => {
		// The answers are what a decision was made on.
		const user = { uid: 'u', status: UserStatus.APPLIED, role: Role.HACKER };
		expect(uploadRefusal(user, question)).toMatch(/already been submitted/);
	});

	it('refuses a question aimed at a different audience', () => {
		const user = { uid: 'u', status: UserStatus.CREATED, role: Role.HACKER };
		expect(uploadRefusal(user, { targetRole: [Role.MENTOR] })).toMatch(/not asked of you/);
	});

	it('allows an untargeted question for any applicant role', () => {
		const user = { uid: 'u', status: UserStatus.CREATED, role: Role.VOLUNTEER };
		expect(uploadRefusal(user, { targetRole: [] })).toBeNull();
	});
});

describe('canDownloadApplicationFile', () => {
	it('lets an applicant read their own file', () => {
		expect(canDownloadApplicationFile({ uid: 'u1', role: Role.HACKER }, 'u1')).toBe(true);
	});

	it('does not let one applicant read another’s', () => {
		expect(canDownloadApplicationFile({ uid: 'u2', role: Role.HACKER }, 'u1')).toBe(false);
	});

	it('lets an admin read anyone’s', () => {
		expect(canDownloadApplicationFile({ uid: 'admin', role: Role.ADMIN }, 'u1')).toBe(true);
	});

	it('does NOT let an organizer read anyone’s', () => {
		// `permissions.ts` keeps organizers out of /admin/users and /admin/admissions,
		// so serving them resumes would be a side door into that data.
		expect(canDownloadApplicationFile({ uid: 'org', role: Role.ORGANIZER }, 'u1')).toBe(false);
	});

	it('does not let other applicant roles read anyone’s', () => {
		for (const role of [Role.JUDGE, Role.MENTOR, Role.VOLUNTEER, Role.UNDECLARED]) {
			expect(canDownloadApplicationFile({ uid: 'x', role }, 'u1')).toBe(false);
		}
	});
});
