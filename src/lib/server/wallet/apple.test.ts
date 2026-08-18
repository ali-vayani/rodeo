import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EXPIRED_CERT_PEM, LONG_LIVED_CERT_PEM } from './test-fixtures/certificates';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

// The model modules reach for `$app/server`, which only exists inside a SvelteKit
// build, and the real bytes are irrelevant to what this file asserts.
vi.mock('./model', () => ({
	loadPassModel: vi.fn(async () => ({ 'pass.json': Buffer.from('{}') }))
}));
vi.mock('./model-local', () => ({
	loadBundledWwdrCertificate: vi.fn(async () => 'WWDR-PEM')
}));

/** Captures what the pass was built from, since a signed zip is opaque to assert on. */
const built: {
	model?: unknown;
	certificates?: Record<string, unknown>;
	props?: Record<string, unknown>;
	barcodes?: unknown;
	headerFields: unknown[];
	secondaryFields: unknown[];
}[] = [];

vi.mock('passkit-generator', () => ({
	PKPass: class {
		headerFields: unknown[] = [];
		secondaryFields: unknown[] = [];
		#record: (typeof built)[number];

		constructor(
			model: unknown,
			certificates: Record<string, unknown>,
			props: Record<string, unknown>
		) {
			this.#record = {
				model,
				certificates,
				props,
				headerFields: this.headerFields,
				secondaryFields: this.secondaryFields
			};
			built.push(this.#record);
		}

		setBarcodes(barcodes: unknown) {
			this.#record.barcodes = barcodes;
		}

		getAsBuffer() {
			return Buffer.from('signed-pkpass');
		}
	}
}));

const { buildApplePass, applePassFilename } = await import('./apple');

const hacker = { uid: 'clx1a2b3c4d5e6f7g8h9i0jk', name: 'Ada Lovelace', group: 'Lunch A' };

function setApple(cert = LONG_LIVED_CERT_PEM) {
	env.APPLE_PASS_SIGNER_CERT = cert;
	env.APPLE_PASS_SIGNER_KEY =
		'-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----';
	env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.freetailhackers.rodeo';
	env.APPLE_PASS_TEAM_IDENTIFIER = 'L9U4TT58WC';
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	built.length = 0;
	setApple();
});

describe('buildApplePass', () => {
	it('is null when Apple is not configured', async () => {
		for (const key of Object.keys(env)) delete env[key];
		expect(await buildApplePass(hacker)).toBeNull();
	});

	it('refuses to build with an expired certificate', async () => {
		// node-forge signs happily with an expired cert; the pass then downloads and
		// is refused by iOS with no diagnostic. Failing here beats shipping a file
		// that silently does not work.
		setApple(EXPIRED_CERT_PEM);
		expect(await buildApplePass(hacker)).toBeNull();
		expect(built).toHaveLength(0);
	});

	it('returns the signed bytes', async () => {
		expect(await buildApplePass(hacker)).toEqual(Buffer.from('signed-pkpass'));
	});

	it('encodes the full uid as the barcode', async () => {
		// The contract with `resolveUserByCode` in the scan router. If this drifts,
		// the wallet pass stops scanning and nobody finds out until check-in.
		await buildApplePass(hacker);
		expect(built[0].barcodes).toEqual({
			message: hacker.uid,
			format: 'PKBarcodeFormatQR',
			messageEncoding: 'iso-8859-1',
			altText: 'RC-I0JK'
		});
	});

	it('takes the identifiers from the environment, not the template', async () => {
		// A certificate reissued under a different team should be a config change.
		await buildApplePass(hacker);
		expect(built[0].props).toMatchObject({
			passTypeIdentifier: 'pass.com.freetailhackers.rodeo',
			teamIdentifier: 'L9U4TT58WC'
		});
	});

	it('uses the uid as the serial number so a re-download replaces the pass', async () => {
		await buildApplePass(hacker);
		expect(built[0].props).toMatchObject({ serialNumber: hacker.uid });
	});

	it('sets relevantDate when the hackathon date is known', async () => {
		const start = new Date('2026-03-28T14:00:00.000Z');
		await buildApplePass(hacker, { hackathonStartDate: start });
		expect(built[0].props).toMatchObject({ relevantDate: start.toISOString() });
	});

	it('omits relevantDate when the date is unset', async () => {
		await buildApplePass(hacker, { hackathonStartDate: null });
		expect(built[0].props).not.toHaveProperty('relevantDate');
	});

	it('shows the attendee and their group', async () => {
		await buildApplePass(hacker);
		expect(built[0].secondaryFields).toEqual([
			{ key: 'attendee', label: 'ATTENDEE', value: 'Ada Lovelace' },
			{ key: 'group', label: 'GROUP', value: 'Lunch A' }
		]);
	});

	it('omits the group field for a hacker with no group', async () => {
		await buildApplePass({ ...hacker, group: null });
		expect(built[0].secondaryFields).toHaveLength(1);
	});

	it('uses the bundled WWDR certificate by default', async () => {
		await buildApplePass(hacker);
		expect(built[0].certificates).toMatchObject({ wwdr: 'WWDR-PEM' });
	});

	it('honours a WWDR override for the eventual G5 transition', async () => {
		env.APPLE_PASS_WWDR_CERT = Buffer.from(LONG_LIVED_CERT_PEM).toString('base64');
		await buildApplePass(hacker);
		expect(built[0].certificates!.wwdr).toBe(LONG_LIVED_CERT_PEM.trim());
	});
});

describe('applePassFilename', () => {
	it('is the display code', () => {
		expect(applePassFilename(hacker.uid)).toBe('RC-I0JK.pkpass');
	});
});
