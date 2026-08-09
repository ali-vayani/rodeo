import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { Role } from '$lib/generated/prisma/client';
import { createTestCaller, adminUser, hackerUser } from '../test-utils';
import { WIPE_KEEPS_ROLES } from '$lib/server/data';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

/**
 * The password lives in the environment, so the gate is mocked rather than the
 * variable set: these tests are about what the router does with a yes or a no,
 * not about how `$env/dynamic/private` resolves.
 */
vi.mock('$lib/server/env', () => ({
	dataPasswordConfigured: vi.fn(() => true),
	verifyDataPassword: vi.fn((candidate: string) => candidate === 'correct-horse')
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { dataPasswordConfigured, verifyDataPassword } = await import('$lib/server/env');

const GOOD = 'correct-horse';

beforeEach(() => {
	mockReset(db);
	vi.mocked(dataPasswordConfigured).mockReturnValue(true);
	vi.mocked(verifyDataPassword).mockImplementation((c: string) => c === GOOD);

	// buildExport runs every findMany inside one $transaction; the mock resolves
	// the array of promises the router hands it.
	db.$transaction.mockImplementation((ops: unknown) =>
		Promise.all(ops as Promise<unknown>[])
	) as never;
	for (const model of [
		db.user,
		db.applicationResponse,
		db.question,
		db.settings,
		db.blacklist,
		db.schedule,
		db.scan,
		db.log,
		db.emailLog,
		db.group,
		db.team,
		db.invitation
	]) {
		(model as { findMany: { mockResolvedValue: (v: unknown) => void } }).findMany.mockResolvedValue(
			[]
		);
		(
			model as { deleteMany?: { mockResolvedValue: (v: unknown) => void } }
		).deleteMany?.mockResolvedValue({ count: 0 });
	}
	db.log.create.mockResolvedValue({} as never);
});

describe('data.exportAll — the password gate', () => {
	it('refuses when no password is configured, rather than letting it through', async () => {
		// Fail closed. A missing variable must never read as "no password required".
		vi.mocked(dataPasswordConfigured).mockReturnValue(false);
		const caller = createTestCaller(db, adminUser);

		await expect(caller.data.exportAll({ password: GOOD })).rejects.toMatchObject({
			code: 'PRECONDITION_FAILED'
		});
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it('refuses a wrong password without reading anything', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(caller.data.exportAll({ password: 'guess' })).rejects.toMatchObject({
			// UNAUTHORIZED, not FORBIDDEN: FORBIDDEN is the role gate's answer, and a
			// mistyped password must stay distinguishable from "not allowed at all".
			code: 'UNAUTHORIZED'
		});
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it('rejects an empty password at the input boundary', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(caller.data.exportAll({ password: '' })).rejects.toThrow();
	});
});

describe('data.exportAll', () => {
	it('returns every table as parseable JSON', async () => {
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		const caller = createTestCaller(db, adminUser);

		const { json, counts } = await caller.data.exportAll({ password: GOOD });
		const parsed = JSON.parse(json);

		expect(Object.keys(parsed.tables).sort()).toEqual(
			[
				'applicationResponse',
				'blacklist',
				'emailLog',
				'group',
				'invitation',
				'log',
				'question',
				'scan',
				'schedule',
				'settings',
				'team',
				'user'
			].sort()
		);
		expect(parsed.tables.user).toHaveLength(1);
		expect(counts.user).toBe(1);
		expect(parsed.version).toBe(1);
	});

	it('reads the whole snapshot in one transaction', async () => {
		// Twelve independent reads would let an application land between two of
		// them and produce a file with answers belonging to nobody.
		const caller = createTestCaller(db, adminUser);
		await caller.data.exportAll({ password: GOOD });
		expect(db.$transaction).toHaveBeenCalledTimes(1);
	});

	it('logs who took a copy', async () => {
		db.user.findMany.mockResolvedValue([hackerUser] as never);
		const caller = createTestCaller(db, adminUser);

		await caller.data.exportAll({ password: GOOD });

		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: 'data.export',
					actorId: adminUser.uid
				})
			})
		);
	});
});

describe('data.wipe', () => {
	it('refuses a wrong password without deleting anything', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(caller.data.wipe({ password: 'guess', confirm: 'WIPE' })).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
		expect(db.user.deleteMany).not.toHaveBeenCalled();
	});

	it('refuses without the typed confirmation, even with the right password', async () => {
		const caller = createTestCaller(db, adminUser);

		await expect(
			// @ts-expect-error the input demands the literal 'WIPE'
			caller.data.wipe({ password: GOOD, confirm: 'wipe' })
		).rejects.toThrow();
		expect(db.user.deleteMany).not.toHaveBeenCalled();
	});

	it('keeps staff accounts', async () => {
		const caller = createTestCaller(db, adminUser);

		await caller.data.wipe({ password: GOOD, confirm: 'WIPE' });

		expect(db.user.deleteMany).toHaveBeenCalledWith({
			where: { role: { notIn: WIPE_KEEPS_ROLES } }
		});
		expect(WIPE_KEEPS_ROLES).toEqual([Role.ADMIN, Role.ORGANIZER]);
	});

	it('never touches the blacklist', async () => {
		// Kept on purpose: the people barred from the event are barred from the
		// next one too, and that list is not reconstructible from an export.
		const caller = createTestCaller(db, adminUser);

		await caller.data.wipe({ password: GOOD, confirm: 'WIPE' });

		expect(db.blacklist.deleteMany).not.toHaveBeenCalled();
	});

	it('empties the tables holding applicant data', async () => {
		const caller = createTestCaller(db, adminUser);

		await caller.data.wipe({ password: GOOD, confirm: 'WIPE' });

		for (const model of [
			db.applicationResponse,
			db.scan,
			db.invitation,
			db.emailLog,
			db.log,
			db.question,
			db.schedule,
			db.settings,
			db.team,
			db.group
		]) {
			expect(model.deleteMany).toHaveBeenCalled();
		}
	});

	it('writes its audit entry after clearing the log, so it survives', async () => {
		// Logged first, the entry would be deleted by the very wipe it records.
		const caller = createTestCaller(db, adminUser);

		await caller.data.wipe({ password: GOOD, confirm: 'WIPE' });

		const deleteOrder = db.log.deleteMany.mock.invocationCallOrder[0];
		const createOrder = db.log.create.mock.invocationCallOrder[0];
		expect(createOrder).toBeGreaterThan(deleteOrder);
	});

	it('does not export on its way past — the caller saves the file first', async () => {
		// The safety property is that the backup is on disk before anything is
		// destroyed, which a server-side export-then-delete cannot provide: its
		// only copy would ride home in a response sent after the delete.
		const caller = createTestCaller(db, adminUser);

		await caller.data.wipe({ password: GOOD, confirm: 'WIPE' });

		expect(db.$transaction).not.toHaveBeenCalled();
	});
});
