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
import { EXTERNAL_RECIPIENT_PREFIX, EXACT_MATCH_FLOOR } from '$lib/server/recipients';
import { NAME_FALLBACK, SAMPLE_VARS } from '$lib/email/variables';
import { DEFAULT_SETTINGS } from '$lib/server/settings';

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

		expect(result).toEqual({ sent: 2, external: 0 });
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ subject: emailInput.subject, body: emailInput.body })
			})
		);
	});

	it('substitutes {{name}} even when no settings row exists', async () => {
		// What organizers actually received: with no Settings row this passed an empty
		// var map, `substituteVariables` found no value for `name`, and the literal
		// `{{name}}` went out in the subject and body of a real send.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			subject: 'Hi {{name}}',
			body: 'Hello {{name}}, see you soon.',
			filters: {},
			expectedCount: 1
		});

		const sent = vi.mocked(sendEmail).mock.calls[0][0];
		expect(sent.subject).toBe(`Hi ${hackerUser.name}`);
		expect(sent.body).toBe(`Hello ${hackerUser.name}, see you soon.`);
		expect(sent.subject).not.toContain('{{');
		expect(sent.body).not.toContain('{{');
	});

	it('falls back to the filler salutation for a user with a blank name', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([{ ...hackerUser, name: '' }] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await caller.email.sendCustom({
			subject: 'Hi {{name}}',
			body: 'Hi {{name}},',
			filters: {},
			expectedCount: 1
		});

		const sent = vi.mocked(sendEmail).mock.calls[0][0];
		expect(sent.subject).toBe(`Hi ${NAME_FALLBACK}`);
		expect(sent.body).toBe(`Hi ${NAME_FALLBACK},`);
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
				where: { AND: [{ role: { in: [Role.HACKER] } }] }
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

		expect(result).toEqual({ sent: 0, external: 0 });
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
		expect(sendEmail).toHaveBeenCalledWith({
			to: hackerUser.email,
			subject: `Hi ${hackerUser.name}`,
			body: `We start ${start}, ${hackerUser.name}.`
		});
		expect(sendEmail).toHaveBeenCalledWith({
			to: appliedHacker.email,
			subject: `Hi ${appliedHacker.name}`,
			body: `We start ${start}, ${appliedHacker.name}.`
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

	it('refuses when the recipient set drifted since the preview', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser, appliedHacker] as never);

		await expect(
			caller.email.sendCustom({ ...emailInput, expectedCount: 1 })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(sendEmail).not.toHaveBeenCalled();
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
		expect(result).toEqual({ sent: 0, external: 0 });
	});
});

describe('email.sendCustom — external recipients', () => {
	const GHOST = 'ghost@yopmail.com';
	const listInput = {
		subject: 'Hi {{name}}',
		body: 'Body {{name}}',
		filters: { emails: [hackerUser.email, GHOST] }
	};

	/** The filtered set, then the membership lookup sendCustom runs for externals. */
	function mockList(users: unknown[], matched: unknown[]) {
		db.user.findMany.mockResolvedValueOnce(users as never).mockResolvedValueOnce(matched as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.emailLog.create.mockResolvedValue(emailLog as never);
	}

	it('mails an address with no account when the toggle is on', async () => {
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		const result = await caller.email.sendCustom({
			...listInput,
			expectedCount: 2,
			allowExternal: true
		});

		expect(result).toEqual({ sent: 2, external: 1 });
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(sendEmail).toHaveBeenCalledWith({
			to: hackerUser.email,
			subject: `Hi ${hackerUser.name}`,
			body: `Body ${hackerUser.name}`
		});
		// The nameless fallback, identical to what the compose preview shows.
		expect(sendEmail).toHaveBeenCalledWith({
			to: GHOST,
			subject: `Hi ${NAME_FALLBACK}`,
			body: `Body ${NAME_FALLBACK}`
		});
	});

	it('skips the unmatched address entirely when the toggle is off', async () => {
		// The unchanged path: an explicit list is a lookup into the User table, and a
		// miss is reported by previewRecipients rather than mailed.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		const result = await caller.email.sendCustom({ ...listInput, expectedCount: 1 });

		expect(result).toEqual({ sent: 1, external: 0 });
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: hackerUser.email }));
		// No membership lookup at all — nothing off this path can reach an address.
		expect(db.user.findMany).toHaveBeenCalledTimes(1);
		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ userIds: [hackerUser.uid] }) })
		);
	});

	it('counts externals into the drift check and refuses a changed set', async () => {
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		// 2 recipients now (1 user + 1 external) against a preview that saw 1.
		await expect(
			caller.email.sendCustom({ ...listInput, expectedCount: 1, allowExternal: true })
		).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('2 now') });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(db.emailLog.create).not.toHaveBeenCalled();
	});

	it('accepts a count that includes the externals', async () => {
		// The other half of the binding: the same set that refuses at 1 sends at 2.
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		await expect(
			caller.email.sendCustom({ ...listInput, expectedCount: 2, allowExternal: true })
		).resolves.toEqual({ sent: 2, external: 1 });
	});

	it('mails a pasted address that belongs to a user once, as that user', async () => {
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		const result = await caller.email.sendCustom({
			...listInput,
			filters: { emails: [hackerUser.email] },
			expectedCount: 1,
			allowExternal: true
		});

		expect(result).toEqual({ sent: 1, external: 0 });
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ subject: `Hi ${hackerUser.name}` })
		);
	});

	it('records external recipients in EmailLog rather than dropping them', async () => {
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		await caller.email.sendCustom({ ...listInput, expectedCount: 2, allowExternal: true });

		expect(db.emailLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					userIds: [hackerUser.uid, `${EXTERNAL_RECIPIENT_PREFIX}${GHOST}`]
				})
			})
		);
	});

	it('names the external count in the audit entry', async () => {
		const caller = createTestCaller(db, adminUser);
		mockList([hackerUser], [{ email: hackerUser.email }]);

		await caller.email.sendCustom({ ...listInput, expectedCount: 2, allowExternal: true });

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'email.custom.send',
					summary: expect.stringContaining('1 external'),
					metadata: expect.objectContaining({
						recipients: 2,
						users: 1,
						external: 1,
						externalAllowed: true
					})
				})
			})
		);
	});

	it('ignores the toggle when no explicit address list was given', async () => {
		// Filter mode has no unmatched addresses for the toggle to admit, so it must
		// not open a second path to the whole database.
		const caller = createTestCaller(db, adminUser);
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.settings.findFirst.mockResolvedValue(mockSettings);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		const result = await caller.email.sendCustom({
			...emailInput,
			filters: { roles: [Role.HACKER] },
			expectedCount: 1,
			allowExternal: true
		});

		expect(result).toEqual({ sent: 1, external: 0 });
		expect(db.user.findMany).toHaveBeenCalledTimes(1);
	});

	it('stays admin-only', async () => {
		// The mitigation that makes an outbound relay acceptable at all.
		const caller = createTestCaller(db, hackerUser);
		await expect(
			caller.email.sendCustom({ ...listInput, expectedCount: 2, allowExternal: true })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
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

	it('leaves unmatched addresses out of the count when the toggle is off', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(1 as never);
		db.user.findMany
			.mockResolvedValueOnce([hackerUser] as never)
			.mockResolvedValueOnce([{ email: hackerUser.email }] as never);

		const result = await caller.email.previewRecipients({
			emails: [hackerUser.email, 'ghost@yopmail.com']
		});

		expect(result.count).toBe(1);
		expect(result.unknownEmails).toEqual(['ghost@yopmail.com']);
		expect(result.externalEmails).toEqual([]);
	});

	it('counts unmatched addresses as recipients when the toggle is on', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(1 as never);
		db.user.findMany
			.mockResolvedValueOnce([hackerUser] as never)
			.mockResolvedValueOnce([{ email: hackerUser.email }] as never);

		const result = await caller.email.previewRecipients({
			emails: [hackerUser.email, 'ghost@yopmail.com'],
			allowExternal: true
		});

		// This is the number the confirm step shows and the send is bound to.
		expect(result.count).toBe(2);
		expect(result.userCount).toBe(1);
		expect(result.externalEmails).toEqual(['ghost@yopmail.com']);
	});

	it('reports an unusable address instead of counting it as a recipient', async () => {
		const caller = createTestCaller(db, adminUser);
		db.user.count.mockResolvedValue(0 as never);
		db.user.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

		const result = await caller.email.previewRecipients({
			emails: ['no@domain'],
			allowExternal: true
		});

		expect(result.count).toBe(0);
		expect(result.invalidEmails).toEqual(['no@domain']);
		expect(result.externalEmails).toEqual([]);
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

describe('email.eventVars', () => {
	it('renders the dates server-side, exactly as a send would', async () => {
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(mockSettings);

		await expect(caller.email.eventVars()).resolves.toEqual({
			hackathon_start: mockSettings.hackathonStartDate.toLocaleDateString(),
			rsvp_deadline: mockSettings.RSVPDeadline.toLocaleDateString()
		});
	});

	it('falls back to the defaults with no Settings row, matching what sendCustom substitutes', async () => {
		// This used to return null, because sendCustom substituted an empty map there and
		// the preview had to show the same. That agreement was honest and both halves were
		// wrong: `{{name}}` reached real inboxes literal. Both sides use the defaults now.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);

		await expect(caller.email.eventVars()).resolves.toEqual({
			hackathon_start: DEFAULT_SETTINGS.hackathonStartDate.toLocaleDateString(),
			rsvp_deadline: DEFAULT_SETTINGS.RSVPDeadline.toLocaleDateString()
		});
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

		expect(sendEmail).toHaveBeenCalledWith({
			to: adminUser.email,
			subject: `Hi ${adminUser.name} — you are in`,
			body: `Hi ${adminUser.name}, we start ${mockSettings.hackathonStartDate.toLocaleDateString()}.`
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

	it('falls back to sample dates when no settings row exists, but never a sample name', async () => {
		// The dates have no source without a Settings row, so the samples stand in and
		// still demonstrate substitution. `name` does have a source — this mail goes to
		// the admin's own inbox — so greeting them as "[hacker name]" (or, before that,
		// as some invented person) would be the one misleading substitution in a message
		// whose entire purpose is proofreading.
		const caller = createTestCaller(db, adminUser);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.email.sendTest(testInput);

		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				subject: `Hi ${adminUser.name} — you are in`,
				body: `Hi ${adminUser.name}, we start ${SAMPLE_VARS.hackathon_start}.`
			})
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

/**
 * Preview and send must resolve the same people from the same input.
 *
 * This is the property the whole exact-first/fuzzy-fallback design exists to keep:
 * similarity is not expressible as a WHERE clause, so it is resolved to explicit names
 * by a resolver both procedures call. If only one of them expanded the search, the
 * expectedCount check would fire on a set nobody changed — or, worse, send to a
 * different set than the one an admin confirmed.
 */
describe('previewRecipients and sendCustom agree on the recipient set', () => {
	const hackers = [
		{ ...hackerUser, uid: 'u1', name: 'Sarah Chen', email: 'sarah@example.com' },
		{ ...appliedHacker, uid: 'u2', name: 'Maria Rodriguez', email: 'maria@example.com' },
		{ ...hackerUser, uid: 'u3', name: 'Adam Hmaidan', email: 'adam@example.com' }
	];

	/**
	 * Staff whose *addresses* contain "adm" — the shape of the live bug.
	 *
	 * Five of them is exactly `EXACT_MATCH_FLOOR`, so a probe counted across the whole
	 * table calls `adm` productive and skips the fold, while the roles filter the caller
	 * actually asked for selects none of them.
	 */
	const staff = Array.from({ length: EXACT_MATCH_FLOOR }, (_, i) => ({
		...adminUser,
		uid: `admin${i}`,
		name: `Admin ${i}`,
		email: `admin${i + 1}@yopmail.com`
	}));

	const roster = [...hackers, ...staff];

	/**
	 * Enough of a Prisma `where` evaluator to answer the questions these procedures ask.
	 *
	 * A counter that returns a fixed number regardless of the predicate cannot tell a
	 * globally-scoped probe from a caller-scoped one, which is the entire difference
	 * under test — so the stub evaluates the predicate against the roster instead.
	 */
	function matches(user: (typeof roster)[number], where: unknown): boolean {
		if (!where || typeof where !== 'object') return true;
		const w = where as Record<string, never>;
		if (Array.isArray(w.AND)) return (w.AND as unknown[]).every((c) => matches(user, c));
		if (Array.isArray(w.OR)) return (w.OR as unknown[]).some((c) => matches(user, c));

		return Object.entries(w).every(([field, cond]) => {
			const value = (user as unknown as Record<string, unknown>)[field];
			if (typeof cond === 'string' || cond === null) return value === cond;
			const c = cond as { contains?: string; in?: unknown[] };
			if (c.contains !== undefined) {
				return String(value ?? '')
					.toLowerCase()
					.includes(c.contains.toLowerCase());
			}
			if (c.in !== undefined) return c.in.includes(value);
			return true;
		});
	}

	/**
	 * Every distinct `where` a procedure asked the database, probe included.
	 *
	 * Deduplicated because preview counts and samples the same predicate while send only
	 * lists it — the interesting comparison is *which* predicates each path used, not how
	 * many times it reused one. The probe is deliberately kept: it is now part of what the
	 * two paths have to agree on.
	 */
	function selectionWheres() {
		const seen = new Set<string>();
		return [
			...db.user.count.mock.calls.map((c) => c[0]?.where),
			...db.user.findMany.mock.calls.map((c) => c[0]?.where)
		].filter((w) => {
			if (w === undefined) return false;
			const key = JSON.stringify(w);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	function stubRoster() {
		db.user.count.mockImplementation(
			(async (args: { where?: unknown }) =>
				roster.filter((u) => matches(u, args?.where)).length) as never
		);
		db.user.findMany.mockImplementation((async (args: { where?: unknown; distinct?: unknown }) => {
			const found = roster.filter((u) => matches(u, args?.where));
			return args?.distinct ? found.map((u) => ({ name: u.name })) : found;
		}) as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);
	}

	beforeEach(stubRoster);

	/** Runs preview then send on the same filters and reports whether they agreed. */
	async function previewThenSend(filters: { search?: string; roles?: Role[] }) {
		const caller = createTestCaller(db, adminUser);
		const preview = await caller.email.previewRecipients({ ...filters, sampleSize: 5 });
		const previewWheres = selectionWheres();

		db.user.count.mockClear();
		db.user.findMany.mockClear();

		const sent = await caller.email.sendCustom({
			subject: 'Hello',
			body: 'Body',
			filters,
			expectedCount: preview.count
		});

		return { preview, sent, previewWheres, sendWheres: selectionWheres() };
	}

	it('builds an identical predicate on both paths for a typo, and sends without drift', async () => {
		const { preview, sent, previewWheres, sendWheres } = await previewThenSend({
			search: 'Sarh Chn'
		});

		// No CONFLICT: the sets matched, which is the whole assertion.
		expect(sent.sent).toBe(preview.count);
		expect(sendWheres).toEqual(previewWheres);
	});

	it('resolved the fuzzy names into the predicate rather than leaving it exact', async () => {
		const caller = createTestCaller(db, adminUser);
		const preview = await caller.email.previewRecipients({ search: 'Sarh Chn', sampleSize: 5 });

		expect(preview.search).toMatchObject({ fuzzy: true, capped: false });
		expect(preview.search.names).toContain('Sarah Chen');
		const where = selectionWheres().at(-1) as { AND: unknown[] };
		expect(where.AND).toContainEqual({
			OR: [
				{ name: { contains: 'Sarh Chn', mode: 'insensitive' } },
				{ email: { contains: 'Sarh Chn', mode: 'insensitive' } },
				{ name: { in: preview.search.names } }
			]
		});
	});

	it('leaves a productive term unexpanded on both paths', async () => {
		// Unfiltered, so the probe's scope IS the whole table — the case scoping must
		// leave exactly as it was. `admin` clears the floor on its own five rows.
		const { preview, sent, previewWheres, sendWheres } = await previewThenSend({
			search: 'admin'
		});
		expect(preview.search).toEqual({
			names: [],
			fuzzy: false,
			capped: false,
			exact: EXACT_MATCH_FLOOR
		});
		expect(preview.count).toBe(EXACT_MATCH_FLOOR);
		expect(sent.sent).toBe(preview.count);
		expect(sendWheres).toEqual(previewWheres);
	});

	/**
	 * The regression this scoping fix exists for, driven through both procedures.
	 *
	 * `adm` has 5 global substring hits and 0 inside `roles: [HACKER]`. A global probe
	 * clears the floor, skips the fold, and both procedures agree on an empty set — the
	 * old behaviour, which is self-consistent but useless. The scoped probe has to reach
	 * `Adam Hmaidan` *and* still have both procedures agree on him.
	 */
	describe('a term whose global and scoped counts differ', () => {
		const filters = { roles: [Role.HACKER], search: 'adm' };

		it('folds on the scoped count, not the global one', async () => {
			const caller = createTestCaller(db, adminUser);
			const preview = await caller.email.previewRecipients({ ...filters, sampleSize: 5 });

			expect(preview.search).toMatchObject({ fuzzy: true });
			expect(preview.search.names).toContain('Adam Hmaidan');
			expect(preview.sample.map((u) => u.name)).toEqual(['Adam Hmaidan']);
			expect(preview.count).toBe(1);
		});

		it('probes inside the caller’s own filters rather than the whole table', async () => {
			await createTestCaller(db, adminUser).email.previewRecipients({
				...filters,
				sampleSize: 5
			});

			// The probe carries the role clause; without it the five admin addresses would
			// clear the floor and suppress the fold.
			const probe = db.user.count.mock.calls[0]?.[0]?.where as { AND: unknown[] };
			expect(probe.AND).toContainEqual({ role: { in: [Role.HACKER] } });
		});

		it('sends to exactly the previewed set, with no CONFLICT', async () => {
			const { preview, sent, previewWheres, sendWheres } = await previewThenSend(filters);

			expect(preview.count).toBe(1);
			expect(sent.sent).toBe(preview.count);
			// Same probe, same expansion, same predicate — including the resolved name.
			expect(sendWheres).toEqual(previewWheres);
			expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].to)).toEqual(['adam@example.com']);
		});
	});
});

describe('email recipient filters — linked application fields', () => {
	it('matches nobody when a linked filter is engaged but empty', async () => {
		// The failure mode recipients.ts was written to prevent: a UI showing "0
		// recipients" must not be able to mail the whole database.
		db.user.findMany.mockResolvedValue([] as never);
		db.user.count.mockResolvedValue(0 as never);

		const caller = createTestCaller(db, adminUser);
		const preview = await caller.email.previewRecipients({ universities: [], sampleSize: 5 });
		expect(preview.count).toBe(0);

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({ uid: 'IMPOSSIBLE_NO_MATCH' });
	});

	it('sends to exactly the selected values', async () => {
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		db.emailLog.create.mockResolvedValue(emailLog as never);

		await createTestCaller(db, adminUser).email.sendCustom({
			subject: 'Hello',
			body: 'Body',
			filters: { universities: ['Rice University'] },
			expectedCount: 1
		});

		const where = db.user.findMany.mock.calls.at(-1)?.[0]?.where as { AND: unknown[] };
		expect(where.AND).toContainEqual({ university: { in: ['Rice University'] } });
	});
});
