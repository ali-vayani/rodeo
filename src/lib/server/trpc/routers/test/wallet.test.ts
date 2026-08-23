import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import {
	EXPIRED_CERT_PEM,
	LONG_LIVED_CERT_PEM
} from '$lib/server/wallet/test-fixtures/certificates';

// Declared here rather than imported: this mock has to hoist above the router
// chain, which pulls in `wallet/config` and reads the environment at call time.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

const provisionGoogleWalletClass = vi.fn(async () => '3388000000022880544.rodeo-2026');
vi.mock('$lib/server/wallet/google', () => ({ provisionGoogleWalletClass }));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;

const { createTestCaller, adminUser, organizerUser, hackerUser, appliedHacker, confirmedHacker } =
	await import('../test-utils');

const RSVP_DEADLINE = new Date('2024-04-01');
const AFTER_DEADLINE = new Date('2024-04-02');

/** Freezes the clock past the RSVP deadline, so only status is in play. */
function afterDeadline() {
	vi.useFakeTimers();
	vi.setSystemTime(AFTER_DEADLINE);
}

function configureBothProviders() {
	env.APPLE_PASS_SIGNER_CERT = LONG_LIVED_CERT_PEM;
	env.APPLE_PASS_SIGNER_KEY =
		'-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----';
	env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.freetailhackers.rodeo';
	env.APPLE_PASS_TEAM_IDENTIFIER = 'L9U4TT58WC';
	env.GOOGLE_WALLET_SERVICE_ACCOUNT = Buffer.from(
		JSON.stringify({
			client_email: 'wallet@rodeo.iam.gserviceaccount.com',
			private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----'
		})
	).toString('base64');
	env.GOOGLE_WALLET_ISSUER_ID = '3388000000022880544';
	env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
}

beforeEach(() => {
	mockReset(db);
	for (const key of Object.keys(env)) delete env[key];
	provisionGoogleWalletClass.mockClear();
	db.settings.findFirst.mockResolvedValue({ RSVPDeadline: RSVP_DEADLINE } as never);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('wallet.availability', () => {
	it('rejects an unauthenticated caller', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.wallet.availability()).rejects.toThrow(/UNAUTHORIZED/);
	});

	it('offers both providers to a confirmed hacker past the deadline', async () => {
		afterDeadline();
		configureBothProviders();

		const caller = createTestCaller(db, confirmedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: true,
			google: true,
			configured: true,
			reason: null
		});
	});

	it('offers nothing to an applicant who never confirmed', async () => {
		afterDeadline();
		configureBothProviders();

		const caller = createTestCaller(db, appliedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: false,
			google: false,
			configured: true,
			reason: 'NOT_CONFIRMED'
		});
	});

	it('withholds passes from a confirmed hacker while the RSVP window is open', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-03-15'));
		configureBothProviders();

		const caller = createTestCaller(db, confirmedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: false,
			google: false,
			configured: true,
			reason: 'RSVP_STILL_OPEN'
		});
	});

	it('reads the deadline from the Settings row, not the router default', async () => {
		// DEFAULT_SETTINGS.RSVPDeadline is `new Date()` at module load, always in the past;
		// sourcing from it would hand a pass to every confirmed account on a fresh install.
		afterDeadline();
		configureBothProviders();
		db.settings.findFirst.mockResolvedValue(null as never);

		const caller = createTestCaller(db, confirmedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: false,
			google: false,
			configured: true,
			reason: 'RSVP_STILL_OPEN'
		});
	});

	it('hides Apple when its certificate has expired but keeps Google', async () => {
		// The two providers fail independently; a lapsed Apple cert must not take
		// Google down with it.
		afterDeadline();
		configureBothProviders();
		env.APPLE_PASS_SIGNER_CERT = EXPIRED_CERT_PEM;

		const caller = createTestCaller(db, confirmedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: false,
			google: true,
			configured: true,
			reason: null
		});
	});

	it('reports configured:false when neither provider has credentials', async () => {
		// Tells the card to render nothing rather than explain a wait: "not offered" and
		// "not offered yet" must stay distinguishable.
		afterDeadline();
		const caller = createTestCaller(db, confirmedHacker);
		expect(await caller.wallet.availability()).toEqual({
			apple: false,
			google: false,
			configured: false,
			reason: null
		});
	});

	it('does not offer passes to a staff account that never applied', async () => {
		afterDeadline();
		configureBothProviders();

		const caller = createTestCaller(db, hackerUser);
		expect((await caller.wallet.availability()).reason).toBe('NOT_CONFIRMED');
	});
});

describe('wallet.provisionGoogleClass', () => {
	it('is refused for a hacker', async () => {
		configureBothProviders();
		const caller = createTestCaller(db, confirmedHacker);
		await expect(caller.wallet.provisionGoogleClass()).rejects.toThrow(/FORBIDDEN/);
	});

	it('is refused for an organizer', async () => {
		// Organizers reach the scan page but not the wallet class definition.
		configureBothProviders();
		const caller = createTestCaller(db, organizerUser);
		await expect(caller.wallet.provisionGoogleClass()).rejects.toThrow(/FORBIDDEN/);
	});

	it('is refused for an unauthenticated caller', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.wallet.provisionGoogleClass()).rejects.toThrow(/UNAUTHORIZED/);
	});

	it('provisions the class for an admin and logs it', async () => {
		configureBothProviders();
		const caller = createTestCaller(db, adminUser);

		expect(await caller.wallet.provisionGoogleClass()).toEqual({
			classId: '3388000000022880544.rodeo-2026'
		});
		expect(provisionGoogleWalletClass).toHaveBeenCalledOnce();
		expect(db.log.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: 'wallet.provisionGoogleClass' })
			})
		);
	});

	it('fails cleanly when Google is not configured', async () => {
		const caller = createTestCaller(db, adminUser);
		await expect(caller.wallet.provisionGoogleClass()).rejects.toThrow(/not configured/);
		expect(provisionGoogleWalletClass).not.toHaveBeenCalled();
	});

	it('surfaces a Google API failure instead of logging a success', async () => {
		configureBothProviders();
		provisionGoogleWalletClass.mockRejectedValueOnce(new Error('403 from walletobjects'));

		const caller = createTestCaller(db, adminUser);
		await expect(caller.wallet.provisionGoogleClass()).rejects.toThrow(/403 from walletobjects/);
		expect(db.log.create).not.toHaveBeenCalled();
	});
});
