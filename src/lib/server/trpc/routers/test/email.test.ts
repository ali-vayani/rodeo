import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role, UserStatus } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	adminUser,
	hackerUser,
	appliedHacker,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendEmail } = await import('$lib/server/email');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendEmail).mockClear();
});

const emailInput = {
	subject: 'Hello Hackers',
	body: 'Welcome to the hackathon!',
	filters: {}
};

const emailLog = {
	id: 'elog-1',
	template: null,
	subject: emailInput.subject,
	body: emailInput.body,
	userIds: [hackerUser.uid],
	sentAt: new Date()
};

describe('email.sendCustom', () => {
	it('sends email to each matching user and creates log', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, appliedHacker] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		const result = await caller.email.sendCustom({ ...emailInput, expectedCount: 2 });

		expect(result).toEqual({ sent: 2 });
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ subject: emailInput.subject, body: emailInput.body })
			})
		);
	});

	it('filters users by role', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			...emailInput,
			filters: { roles: [Role.HACKER] },
			expectedCount: 1
		});

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: [{ roles: { hasSome: [Role.HACKER] } }] }
			})
		);
	});

	it('filters users by status', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([appliedHacker] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			...emailInput,
			filters: { statuses: [UserStatus.APPLIED] },
			expectedCount: 1
		});

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: [{ status: { in: [UserStatus.APPLIED] } }] }
			})
		);
	});

	it('returns sent=0 when no users match filters', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		const result = await caller.email.sendCustom({ ...emailInput, expectedCount: 0 });

		expect(result).toEqual({ sent: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(db.emailLog.create).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.email.sendCustom({ ...emailInput, expectedCount: 0 })
		).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('substitutes variables per recipient in both subject and body', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, appliedHacker] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			subject: 'Hi {{name}}',
			body: 'We start {{hackathon_start}}, {{name}}.',
			filters: {},
			expectedCount: 2
		});

		const start = mockSettings.hackathonStartDate.toLocaleDateString();
		// Neither fixture has confirmed, so no check-in block and no attachment.
		expect(sendEmail).toHaveBeenCalledWith({
			to: hackerUser.email,
			subject: `Hi ${hackerUser.name}`,
			body: `We start ${start}, ${hackerUser.name}.`,
			attachments: []
		});
		expect(sendEmail).toHaveBeenCalledWith({
			to: appliedHacker.email,
			subject: `Hi ${appliedHacker.name}`,
			body: `We start ${start}, ${appliedHacker.name}.`,
			attachments: []
		});
	});

	it('logs the raw template, not a rendered copy', async () => {
		// One EmailLog row covers N recipients, so storing a rendered body would
		// arbitrarily pick one recipient's values and misrepresent the rest.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			subject: 'Hi {{name}}',
			body: 'Body {{name}}',
			filters: {},
			expectedCount: 1
		});

		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ subject: 'Hi {{name}}', body: 'Body {{name}}' })
			})
		);
	});

	it('sends nothing when the decision filter is engaged but empty', async () => {
		// The mass-mail regression: this used to drop the clause and match everyone.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([] as never);

		const result = await caller.email.sendCustom({
			...emailInput,
			filters: { decisions: [], includeNoDecision: false },
			expectedCount: 0
		});

		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }] } })
		);
		expect(result).toEqual({ sent: 0 });
	});
});

describe('email.previewRecipients', () => {
	it('returns the count and a sample without sending', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(42 as never);
		db.user.findMany.mockResolvedValue([hackerUser] as never);

		const result = await caller.email.previewRecipients({ roles: [Role.HACKER] });

		expect(result.count).toBe(42);
		expect(result.sample).toEqual([hackerUser]);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('uses the same predicate sendCustom would use', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValue([] as never);

		await caller.email.previewRecipients({ decisions: [], includeNoDecision: false });

		expect(db.user.count).toHaveBeenCalledWith({
			where: { AND: [{ uid: 'IMPOSSIBLE_NO_MATCH' }] }
		});
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.email.previewRecipients({})).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('reports addresses that match no user', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(1 as never);
		db.user.findMany
			.mockResolvedValueOnce([hackerUser] as never) // the sample
			.mockResolvedValueOnce([{ email: hackerUser.email }] as never); // the existence check

		const result = await caller.email.previewRecipients({
			emails: [hackerUser.email, 'ghost@yopmail.com']
		});

		expect(result.unknownEmails).toEqual(['ghost@yopmail.com']);
	});

	it('reports no unknowns when every address resolves', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(1 as never);
		db.user.findMany
			.mockResolvedValueOnce([hackerUser] as never)
			.mockResolvedValueOnce([{ email: hackerUser.email }] as never);

		const result = await caller.email.previewRecipients({ emails: [hackerUser.email] });

		expect(result.unknownEmails).toEqual([]);
	});

	it('skips the existence check when no address list was given', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(3 as never);
		db.user.findMany.mockResolvedValue([hackerUser] as never);

		const result = await caller.email.previewRecipients({ roles: [Role.HACKER] });

		expect(result.unknownEmails).toEqual([]);
		expect(db.user.findMany).toHaveBeenCalledTimes(1);
	});
});

describe('email.sendTest', () => {
	const testInput = {
		template: 'accept' as const,
		subject: 'Hi {{name}} — you are in',
		body: 'Hi {{name}}, we start {{hackathon_start}}.'
	};

	it('defaults the recipient to the calling admin', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		const result = await caller.email.sendTest(testInput);

		expect(result.to).toBe(adminUser.email);
		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: adminUser.email }));
	});

	it('substitutes variables into both the subject and the body', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.email.sendTest(testInput);

		// sendTest renders the admin as CONFIRMED so a block variable is proofreadable,
		// which means this send always carries the QR image.
		expect(sendEmail).toHaveBeenCalledWith({
			to: adminUser.email,
			subject: `Hi ${adminUser.name} — you are in`,
			body: `Hi ${adminUser.name}, we start ${mockSettings.hackathonStartDate.toLocaleDateString()}.`,
			attachments: [expect.objectContaining({ contentType: 'image/png', inline: true })]
		});
	});

	it('always sends to the calling admin, never an arbitrary address', async () => {
		// The `to` field was removed: sendTest is a "read your draft in your own inbox"
		// tool, not an authenticated relay to any address.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		const result = await caller.email.sendTest(testInput);

		expect(result.to).toBe(adminUser.email);
	});

	it('falls back to sample variables when no settings row exists', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.email.sendTest(testInput);

		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ subject: 'Hi Sarah Chen — you are in' })
		);
	});

	it('does not write an EmailLog row', async () => {
		// EmailLog is the audit trail of real sends; test sends must stay out of it.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await caller.email.sendTest(testInput);

		expect(db.emailLog.create).not.toHaveBeenCalled();
	});

	it('throws FORBIDDEN for non-admin', async () => {
		const caller = createTestCaller(db, hackerUser);
		await expect(caller.email.sendTest(testInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('email.getLogs', () => {
	it('returns paginated logs', async () => {
		const caller = createTestCaller(db, adminUser);
		db.emailLog.count.mockResolvedValue(1);
		db.emailLog.findMany.mockResolvedValue([emailLog] as never);

		const result = await caller.email.getLogs({ page: 1, pageSize: 20 });

		expect(result.logs).toEqual([emailLog]);
		expect(result.total).toBe(1);
		expect(result.page).toBe(1);
	});

	it('applies correct pagination offset', async () => {
		const caller = createTestCaller(db, adminUser);
		db.emailLog.count.mockResolvedValue(50);
		db.emailLog.findMany.mockResolvedValue([]);

		await caller.email.getLogs({ page: 3, pageSize: 10 });

		expect(db.emailLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 20, take: 10 })
		);
	});
});
