import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

// A real keypair, so the JWT signature is genuinely verified rather than assumed.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	publicKeyEncoding: { type: 'spki', format: 'pem' }
});

const authorize = vi.fn(async () => ({ access_token: 'test-token' }));
vi.mock('google-auth-library', () => ({
	JWT: class {
		authorize = authorize;
	}
}));

const { buildGoogleSaveUrl, provisionGoogleWalletClass, resetGoogleClassMemo, SAFE_JWT_LENGTH } =
	await import('./google');

const ISSUER = '3388000000022880544';
const CLIENT_EMAIL = 'wallet@rodeo-test.iam.gserviceaccount.com';

const hacker = { uid: 'clx1a2b3c4d5e6f7g8h9i0jk', name: 'Ada Lovelace', group: 'Lunch A' };

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

/**
 * A wallet API stub.
 *
 * `classExists` drives the GET on the class; `objectConflict` makes the object
 * POST return 409 so the PATCH path is exercised.
 */
function stubWalletApi({ classExists = false, objectConflict = false } = {}) {
	const calls: Call[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: { method: string; body?: string }) => {
			calls.push({
				url,
				method: init.method,
				body: init.body ? JSON.parse(init.body) : undefined
			});

			const path = url.replace('https://walletobjects.googleapis.com/walletobjects/v1', '');

			if (init.method === 'GET' && path.startsWith('/genericClass/')) {
				return new Response(classExists ? '{}' : null, { status: classExists ? 200 : 404 });
			}
			if (init.method === 'POST' && path === '/genericObject' && objectConflict) {
				return new Response(null, { status: 409 });
			}
			return new Response('{}', { status: 200 });
		})
	);
	return calls;
}

function decodeJwt(url: string) {
	const token = url.replace('https://pay.google.com/gp/v/save/', '');
	const [header, claims, signature] = token.split('.');
	return {
		token,
		header: JSON.parse(Buffer.from(header, 'base64url').toString()),
		claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
		verify: () =>
			createVerify('RSA-SHA256')
				.update(`${header}.${claims}`)
				.verify(publicKey, Buffer.from(signature, 'base64url'))
	};
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	env.GOOGLE_WALLET_SERVICE_ACCOUNT = Buffer.from(
		JSON.stringify({ client_email: CLIENT_EMAIL, private_key: privateKey })
	).toString('base64');
	env.GOOGLE_WALLET_ISSUER_ID = ISSUER;
	env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
	resetGoogleClassMemo();
	authorize.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('buildGoogleSaveUrl', () => {
	it('is null when Google is not configured', async () => {
		delete env.GOOGLE_WALLET_SERVICE_ACCOUNT;
		expect(await buildGoogleSaveUrl(hacker)).toBeNull();
	});

	it('returns a pay.google.com save link', async () => {
		stubWalletApi();
		const url = await buildGoogleSaveUrl(hacker);
		expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/);
	});

	it('signs the token with the service-account key', async () => {
		stubWalletApi();
		const { header, claims, verify } = decodeJwt((await buildGoogleSaveUrl(hacker))!);

		expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
		expect(claims.iss).toBe(CLIENT_EMAIL);
		expect(claims.aud).toBe('google');
		expect(claims.typ).toBe('savetowallet');
		expect(verify()).toBe(true);
	});

	it('carries the uid barcode into the stored object', async () => {
		// The contract with `resolveUserByCode` in the scan router. If this drifts,
		// the wallet pass stops scanning and nobody finds out until check-in.
		const calls = stubWalletApi();
		await buildGoogleSaveUrl(hacker);

		const insert = calls.find((call) => call.url.endsWith('/genericObject'))!;
		expect(insert.body!.barcode).toMatchObject({ type: 'QR_CODE', value: hacker.uid });
	});

	it('shows the same RC- code the account page does', async () => {
		// QRCard.svelte derives it as 'RC-' + uid.slice(-4).toUpperCase(). Both the
		// printed code and the scanner's `RC-`-stripping suffix match depend on this
		// being the same four characters in both places.
		const calls = stubWalletApi();
		await buildGoogleSaveUrl(hacker);

		const expected = 'RC-' + hacker.uid.slice(-4).toUpperCase();
		expect(expected).toBe('RC-I0JK');
		const insert = calls.find((call) => call.url.endsWith('/genericObject'))!;
		expect(insert.body!.barcode).toMatchObject({ alternateText: expected });
	});

	it('references the object by id, keeping personal data out of the URL', async () => {
		// The save link ends up in browser history and referrer headers.
		const { claims } = decodeJwt((await stubAndBuild())!);

		expect(claims.payload.genericObjects).toEqual([
			{ id: `${ISSUER}.${hacker.uid}`, classId: `${ISSUER}.rodeo-2026` }
		]);
		expect(JSON.stringify(claims)).not.toContain(hacker.name);
	});

	it('keeps the save URL under the 1800-character limit', async () => {
		// Google truncates past this and the save fails silently. The reference-form
		// payload is constant-size, so a very long name must not change the answer —
		// which is the whole reason the object is not inlined. If this fails, someone
		// has moved data back into the JWT.
		stubWalletApi();
		const verbose = {
			uid: 'clx1a2b3c4d5e6f7g8h9i0jk',
			name: 'Bartholomew Maximilian Vandersomething-Hyphenated III',
			group: 'Saturday Lunch Rotation Group Number Fourteen'
		};

		const url = (await buildGoogleSaveUrl(verbose))!;
		const token = url.replace('https://pay.google.com/gp/v/save/', '');
		expect(token.length).toBeLessThan(SAFE_JWT_LENGTH);
	});

	it('omits the group module for a hacker with no group', async () => {
		const calls = stubWalletApi();
		await buildGoogleSaveUrl({ ...hacker, group: null });

		const insert = calls.find((call) => call.url.endsWith('/genericObject'))!;
		const modules = insert.body!.textModulesData as { id: string }[];
		expect(modules.map((module) => module.id)).toEqual(['check-in-code']);
	});
});

describe('class provisioning', () => {
	it('creates the class when it is absent', async () => {
		const calls = stubWalletApi({ classExists: false });
		await buildGoogleSaveUrl(hacker);

		expect(
			calls.filter((c) => c.method === 'POST' && c.url.endsWith('/genericClass'))
		).toHaveLength(1);
	});

	it('does not create the class when it already exists', async () => {
		const calls = stubWalletApi({ classExists: true });
		await buildGoogleSaveUrl(hacker);

		expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/genericClass'))).toBe(false);
	});

	it('issues exactly one class POST across concurrent calls', async () => {
		// Two hackers clicking at the same moment on a cold instance.
		const calls = stubWalletApi({ classExists: false });
		await Promise.all([buildGoogleSaveUrl(hacker), buildGoogleSaveUrl(hacker)]);

		expect(
			calls.filter((c) => c.method === 'POST' && c.url.endsWith('/genericClass'))
		).toHaveLength(1);
	});

	it('does not memoise a failure', async () => {
		// A transient outage must not disable passes until the next deploy.
		let failing = true;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: { method: string }) => {
				if (init.method === 'GET' && url.includes('/genericClass/')) {
					if (failing) return new Response(null, { status: 500 });
					return new Response('{}', { status: 200 });
				}
				return new Response('{}', { status: 200 });
			})
		);

		await expect(buildGoogleSaveUrl(hacker)).rejects.toThrow(/500/);
		failing = false;
		await expect(buildGoogleSaveUrl(hacker)).resolves.toContain('pay.google.com');
	});
});

describe('object upsert', () => {
	it('patches an object that already exists', async () => {
		// POST-then-PATCH rather than GET-then-decide: two concurrent clicks would
		// both read "absent" and both try to insert.
		const calls = stubWalletApi({ objectConflict: true });
		await buildGoogleSaveUrl(hacker);

		const patch = calls.find((call) => call.method === 'PATCH');
		expect(patch?.url).toContain(`/genericObject/${ISSUER}.${hacker.uid}`);
	});

	it('surfaces an unexpected failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: { method: string }) => {
				if (init.method === 'GET') return new Response('{}', { status: 200 });
				if (url.endsWith('/genericObject')) return new Response(null, { status: 403 });
				return new Response('{}', { status: 200 });
			})
		);

		await expect(buildGoogleSaveUrl(hacker)).rejects.toThrow(/403/);
	});
});

describe('provisionGoogleWalletClass', () => {
	it('PUTs over an existing class', async () => {
		const calls = stubWalletApi({ classExists: true });
		await expect(provisionGoogleWalletClass()).resolves.toBe(`${ISSUER}.rodeo-2026`);

		expect(calls.some((call) => call.method === 'PUT')).toBe(true);
	});

	it('POSTs when the class does not exist yet', async () => {
		const calls = stubWalletApi({ classExists: false });
		await provisionGoogleWalletClass();

		expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/genericClass'))).toBe(true);
	});

	it('refuses when Google is not configured', async () => {
		delete env.GOOGLE_WALLET_SERVICE_ACCOUNT;
		await expect(provisionGoogleWalletClass()).rejects.toThrow(/not configured/);
	});
});

/** Builds with a default stub, for tests that only care about the token. */
async function stubAndBuild() {
	stubWalletApi();
	return await buildGoogleSaveUrl(hacker);
}
