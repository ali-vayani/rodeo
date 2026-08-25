import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	adminUser,
	hackerUser,
	organizerUser,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(db));

describe('settings.get', () => {
	it('returns the full row to an admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		const result = await caller.settings.get();
		expect(result).toEqual(mockSettings);
	});

	it('returns DEFAULT_SETTINGS when no row exists', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(null);
		const result = await caller.settings.get();
		expect(result).toMatchObject({
			scanActions: ['Check-In'],
			timezone: 'America/Chicago'
		});
	});

	it('withholds the email templates from a hacker', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		const result = await caller.settings.get();

		// Emptied rather than dropped — callers are typed against the full row.
		expect(result).toMatchObject({
			acceptTemplate: '',
			acceptSubject: '',
			rejectTemplate: '',
			waitlistTemplate: '',
			submitTemplate: '',
			confirmTemplate: '',
			declineTemplate: ''
		});
		expect(JSON.stringify(result)).not.toContain('accepted!');
	});

	it('still gives a hacker the dates and timezone the portal renders', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		const result = await caller.settings.get();

		expect(result).toMatchObject({
			id: mockSettings.id,
			RSVPDeadline: mockSettings.RSVPDeadline,
			applicationDeadline: mockSettings.applicationDeadline,
			hackathonStartDate: mockSettings.hackathonStartDate,
			timezone: mockSettings.timezone
		});
	});

	it('withholds the email templates from an organizer but keeps scanActions', async () => {
		// The scan page is organizer-reachable and loads settings for its scan
		// groups; the mail copy is admin-only. See $lib/auth/permissions.
		const caller = createTestCaller(db, organizerUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		const result = await caller.settings.get();

		expect(result.scanActions).toEqual(mockSettings.scanActions);
		expect(result.acceptTemplate).toBe('');
	});

	it('redacts the defaults too when no row exists', async () => {
		// The fresh-install path returns DEFAULT_SETTINGS, whose templates are real
		// copy — it can't be the one branch that skips the projection.
		const caller = createTestCaller(db, hackerUser);
		db.settings.findFirst.mockResolvedValue(null);

		const result = await caller.settings.get();

		expect(result.acceptTemplate).toBe('');
		expect(result.timezone).toBe('America/Chicago');
	});

	it('throws UNAUTHORIZED when not logged in', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.settings.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});
});

describe('settings.update', () => {
	it('updates existing row', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.settings.update.mockResolvedValue({ ...mockSettings, timezone: 'America/New_York' });

		const result = await caller.settings.update({ ...mockSettings, timezone: 'America/New_York' });

		expect(db.settings.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: mockSettings.id } })
		);
		expect(result.timezone).toBe('America/New_York');
	});

	it('stores a null RSVP deadline untouched', async () => {
		// A bare z.coerce.date() would turn null into the 1970 epoch; the nullable
		// wrapper must pass it through so "no deadline" survives the round trip.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.settings.update.mockResolvedValue({ ...mockSettings, RSVPDeadline: null });

		await caller.settings.update({ ...mockSettings, RSVPDeadline: null });

		expect(db.settings.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ RSVPDeadline: null }) })
		);
	});

	it('creates row when none exists', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);
		db.settings.create.mockResolvedValue(mockSettings);

		await caller.settings.update(mockSettings);

		expect(db.settings.create).toHaveBeenCalled();
		expect(db.settings.update).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.settings.update(mockSettings)).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});
});

describe('settings.updateTemplates', () => {
	const templates = { accept: { subject: 'New subject', body: 'New body' } };

	it('writes only the template columns it was given', async () => {
		// Regression guard: this is the whole reason updateTemplates exists. A full
		// settings.update from this page would clobber a concurrent edit elsewhere.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.settings.update.mockResolvedValue(mockSettings);

		await caller.settings.updateTemplates({ templates });

		expect(db.settings.update).toHaveBeenCalledWith({
			where: { id: mockSettings.id },
			data: { acceptSubject: 'New subject', acceptTemplate: 'New body' }
		});
	});

	it('leaves untouched templates alone', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.settings.update.mockResolvedValue(mockSettings);

		await caller.settings.updateTemplates({ templates });

		const { data } = db.settings.update.mock.calls[0][0];
		expect(Object.keys(data)).toEqual(['acceptSubject', 'acceptTemplate']);
	});

	it('creates a row from DEFAULT_SETTINGS when none exists', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);
		db.settings.create.mockResolvedValue(mockSettings);

		await caller.settings.updateTemplates({ templates });

		expect(db.settings.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				acceptSubject: 'New subject',
				acceptTemplate: 'New body',
				timezone: 'America/Chicago'
			})
		});
	});

	it('rejects an empty subject', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(
			caller.settings.updateTemplates({ templates: { accept: { subject: '', body: 'x' } } })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.settings.updateTemplates({ templates })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('throws UNAUTHORIZED when not logged in', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.settings.updateTemplates({ templates })).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});
