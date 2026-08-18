import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EXPIRED_CERT_PEM, LONG_LIVED_CERT_PEM } from './test-fixtures/certificates';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

const {
	appleWalletCredentials,
	appleWalletConfigured,
	googleWalletCredentials,
	googleWalletConfigured,
	passAssetSource,
	walletAssetsBaseUrl,
	walletConfigWarnings
} = await import('./config');

const { validateEnv } = await import('$lib/server/env');

/** A syntactically valid service-account key file, with a real PEM private key. */
const SERVICE_ACCOUNT = {
	type: 'service_account',
	project_id: 'rodeo-test',
	client_email: 'wallet@rodeo-test.iam.gserviceaccount.com',
	private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----\n'
};

function setApple(cert = LONG_LIVED_CERT_PEM) {
	env.APPLE_PASS_SIGNER_CERT = cert;
	env.APPLE_PASS_SIGNER_KEY =
		'-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----';
	env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.freetailhackers.rodeo';
	env.APPLE_PASS_TEAM_IDENTIFIER = 'L9U4TT58WC';
}

function setGoogle(account: object = SERVICE_ACCOUNT) {
	env.GOOGLE_WALLET_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(account)).toString('base64');
	env.GOOGLE_WALLET_ISSUER_ID = '3388000000022880544';
	env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('appleWalletCredentials', () => {
	it('is null when nothing is set', () => {
		expect(appleWalletCredentials()).toBeNull();
	});

	it('is null when only some variables are set', () => {
		env.APPLE_PASS_SIGNER_CERT = LONG_LIVED_CERT_PEM;
		expect(appleWalletCredentials()).toBeNull();
	});

	it('normalises the certificate and key', () => {
		setApple(Buffer.from(LONG_LIVED_CERT_PEM).toString('base64'));
		const credentials = appleWalletCredentials();
		expect(credentials?.signerCert).toBe(LONG_LIVED_CERT_PEM.trim());
		expect(credentials?.passTypeIdentifier).toBe('pass.com.freetailhackers.rodeo');
	});

	it('treats an empty passphrase as absent', () => {
		// passkit-generator distinguishes `undefined` from `''`, and an unencrypted
		// key with `''` fails differently from one with no passphrase at all.
		setApple();
		env.APPLE_PASS_SIGNER_KEY_PASSPHRASE = '';
		expect(appleWalletCredentials()?.signerKeyPassphrase).toBeUndefined();
	});
});

describe('appleWalletConfigured', () => {
	it('is false when unset', () => {
		expect(appleWalletConfigured()).toBe(false);
	});

	it('is true for a current certificate', () => {
		setApple();
		expect(appleWalletConfigured()).toBe(true);
	});

	it('is false for an expired certificate', () => {
		// The whole point: an expired cert still signs, and the pass is only rejected
		// later, on the device. Hiding the button beats issuing passes that fail.
		setApple(EXPIRED_CERT_PEM);
		expect(appleWalletConfigured()).toBe(false);
	});

	it('is false rather than throwing for a malformed certificate', () => {
		setApple('this is not a certificate');
		expect(appleWalletConfigured()).toBe(false);
	});
});

describe('googleWalletCredentials', () => {
	it('is null when nothing is set', () => {
		expect(googleWalletCredentials()).toBeNull();
	});

	it('decodes a base64 service account', () => {
		setGoogle();
		const credentials = googleWalletCredentials();
		expect(credentials?.clientEmail).toBe('wallet@rodeo-test.iam.gserviceaccount.com');
		expect(credentials?.issuerId).toBe('3388000000022880544');
	});

	it('accepts raw JSON too', () => {
		env.GOOGLE_WALLET_SERVICE_ACCOUNT = JSON.stringify(SERVICE_ACCOUNT);
		env.GOOGLE_WALLET_ISSUER_ID = '3388000000022880544';
		env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
		expect(googleWalletCredentials()?.clientEmail).toBe(SERVICE_ACCOUNT.client_email);
	});

	it('explains the truncation trap when handed a bare brace', () => {
		// Exactly what the previous Rodeo's .env contained: the multi-line JSON was
		// pasted unquoted, so dotenv kept the first line and dropped the rest.
		env.GOOGLE_WALLET_SERVICE_ACCOUNT = '{';
		env.GOOGLE_WALLET_ISSUER_ID = '3388000000022880544';
		env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
		expect(() => googleWalletCredentials()).toThrow(/base64|truncates/);
	});

	it('rejects a key file missing client_email', () => {
		setGoogle({ private_key: SERVICE_ACCOUNT.private_key });
		expect(() => googleWalletCredentials()).toThrow(/client_email/);
	});

	it('googleWalletConfigured swallows the throw', () => {
		env.GOOGLE_WALLET_SERVICE_ACCOUNT = '{';
		env.GOOGLE_WALLET_ISSUER_ID = 'x';
		env.GOOGLE_WALLET_CLASS_SUFFIX = 'y';
		expect(googleWalletConfigured()).toBe(false);
	});
});

describe('passAssetSource', () => {
	it('is local in development', () => {
		expect(passAssetSource()).toBe('local');
	});

	it('is local in production without a base URL', () => {
		env.VERCEL_ENV = 'production';
		expect(passAssetSource()).toBe('local');
	});

	it('is remote in production with a base URL', () => {
		env.VERCEL_ENV = 'production';
		env.WALLET_ASSETS_BASE_URL = 'https://assets.example.com/ticket.pass';
		expect(passAssetSource()).toBe('remote');
	});

	it('honours an explicit override so the remote path is reachable locally', () => {
		// Without this, the production branch is only ever executed in production,
		// which is how it comes to be broken there.
		env.WALLET_ASSETS_BASE_URL = 'https://assets.example.com/ticket.pass';
		env.WALLET_ASSETS_SOURCE = 'remote';
		expect(passAssetSource()).toBe('remote');

		env.VERCEL_ENV = 'production';
		env.WALLET_ASSETS_SOURCE = 'local';
		expect(passAssetSource()).toBe('local');
	});

	it('ignores an unrecognised override rather than guessing', () => {
		env.WALLET_ASSETS_SOURCE = 'S3';
		expect(passAssetSource()).toBe('local');
	});

	it('strips a trailing slash from the base URL', () => {
		env.WALLET_ASSETS_BASE_URL = 'https://assets.example.com/ticket.pass//';
		expect(walletAssetsBaseUrl()).toBe('https://assets.example.com/ticket.pass');
	});
});

describe('walletConfigWarnings', () => {
	it('says nothing when both providers are entirely absent', () => {
		// Absent is a deliberate off switch, not a mistake.
		expect(walletConfigWarnings()).toEqual([]);
	});

	it('says nothing when both providers are fully configured', () => {
		setApple();
		setGoogle();
		expect(walletConfigWarnings()).toEqual([]);
	});

	it('names the missing variables when a provider is half-configured', () => {
		env.APPLE_PASS_SIGNER_CERT = LONG_LIVED_CERT_PEM;
		env.APPLE_PASS_SIGNER_KEY = 'x';
		const [warning] = walletConfigWarnings();
		expect(warning).toContain('APPLE_PASS_TYPE_IDENTIFIER');
		expect(warning).toContain('APPLE_PASS_TEAM_IDENTIFIER');
	});

	it('calls out an expired certificate by name', () => {
		setApple(EXPIRED_CERT_PEM);
		expect(walletConfigWarnings().join(' ')).toMatch(/expired/i);
	});

	it('calls out an unparseable service account', () => {
		env.GOOGLE_WALLET_SERVICE_ACCOUNT = '{';
		env.GOOGLE_WALLET_ISSUER_ID = 'x';
		env.GOOGLE_WALLET_CLASS_SUFFIX = 'y';
		expect(walletConfigWarnings().join(' ')).toMatch(/Google Wallet is disabled/);
	});
});

describe('the wallet is never boot-critical', () => {
	it('still boots in production with no wallet configuration at all', () => {
		// The contract from the header comment on ./config.ts. A missing certificate
		// takes away one button; it must never take away the application form.
		env.VERCEL_ENV = 'production';
		env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/rodeo';
		env.SUPABASE_URL = 'https://project.supabase.co';
		env.SUPABASE_ANON_KEY = 'anon-key';
		env.RESEND_API_KEY = 'resend-key';

		expect(() => validateEnv()).not.toThrow();
	});

	it('still boots in production with an expired Apple certificate', () => {
		// The renewal-day scenario. Certificates expire annually; the site must not.
		env.VERCEL_ENV = 'production';
		env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/rodeo';
		env.SUPABASE_URL = 'https://project.supabase.co';
		env.SUPABASE_ANON_KEY = 'anon-key';
		env.RESEND_API_KEY = 'resend-key';
		setApple(EXPIRED_CERT_PEM);

		expect(() => validateEnv()).not.toThrow();
	});
});
