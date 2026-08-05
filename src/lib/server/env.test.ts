import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { deployEnv, isProduction, usesSupabaseAuth, emailTransport, emailFrom, validateEnv } =
	await import('./env');

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => vi.unstubAllEnvs());

/** Everything a production boot needs, so each test can remove exactly one thing. */
function completeProductionEnv() {
	env.VERCEL_ENV = 'production';
	env.DATABASE_URL = 'postgres://localhost/rodeo';
	env.SUPABASE_URL = 'https://project.supabase.co';
	env.SUPABASE_ANON_KEY = 'anon';
	env.RESEND_API_KEY = 'key';
}

describe('deployEnv', () => {
	it('prefers VERCEL_ENV over NODE_ENV', () => {
		vi.stubEnv('NODE_ENV', 'production');
		env.VERCEL_ENV = 'preview';

		// A preview deploy is a production *build*, which is exactly why NODE_ENV
		// can't be the source of truth here.
		expect(deployEnv()).toBe('preview');
		expect(isProduction()).toBe(false);
	});

	it('falls back to NODE_ENV off Vercel', () => {
		vi.stubEnv('NODE_ENV', 'production');
		expect(deployEnv()).toBe('production');
	});

	it('ignores an unrecognised VERCEL_ENV value', () => {
		env.VERCEL_ENV = 'staging';
		expect(deployEnv()).toBe('development');
	});
});

describe('usesSupabaseAuth', () => {
	it('is off only on localhost', () => {
		expect(usesSupabaseAuth()).toBe(false);
	});

	it.each(['production', 'preview'])('is on for %s', (where) => {
		env.VERCEL_ENV = where;
		// The yopmail bypass against a preview deploy would be an unauthenticated
		// door into the production database.
		expect(usesSupabaseAuth()).toBe(true);
	});
});

describe('emailTransport', () => {
	it('is null when nothing is configured', () => {
		expect(emailTransport()).toBeNull();
	});

	it('is smtp only when the whole SMTP triple is present', () => {
		env.EMAIL_HOST = 'smtp.example.com';
		expect(emailTransport()).toBeNull();

		env.EMAIL_USER = 'user';
		env.EMAIL_PASS = 'pass';
		expect(emailTransport()).toBe('smtp');
	});

	it('prefers resend', () => {
		env.EMAIL_HOST = 'smtp.example.com';
		env.EMAIL_USER = 'user';
		env.EMAIL_PASS = 'pass';
		env.RESEND_API_KEY = 'key';

		expect(emailTransport()).toBe('resend');
	});
});

describe('emailFrom', () => {
	it('defaults to the Freetail address', () => {
		expect(emailFrom()).toBe('hello@freetailhackers.com');
	});
});

describe('validateEnv', () => {
	it('requires DATABASE_URL everywhere', () => {
		expect(() => validateEnv()).toThrow('DATABASE_URL');
	});

	it('requires nothing else in development', () => {
		env.DATABASE_URL = 'postgres://localhost/rodeo';
		env.ALLOW_DEV_AUTH = '1';
		expect(() => validateEnv()).not.toThrow();
	});

	it('refuses to boot into the dev bypass without ALLOW_DEV_AUTH', () => {
		env.DATABASE_URL = 'postgres://localhost/rodeo';

		// A deploy that forgets NODE_ENV=production lands here, and the dev bypass
		// would hand out the seeded admin account to anyone who reaches /login.
		expect(() => validateEnv()).toThrow('ALLOW_DEV_AUTH');
	});

	it('refuses an unrecognised VERCEL_ENV without ALLOW_DEV_AUTH', () => {
		env.DATABASE_URL = 'postgres://localhost/rodeo';
		env.VERCEL_ENV = 'staging';

		// Unrecognised resolves to 'development', which is exactly the case the
		// opt-in exists to catch — a real deploy that reads as localhost.
		expect(() => validateEnv()).toThrow('ALLOW_DEV_AUTH');
	});

	it.each(['production', 'preview'])('never asks for ALLOW_DEV_AUTH on %s', (where) => {
		completeProductionEnv();
		env.VERCEL_ENV = where;

		// The flag governs the bypass only. Supabase auth is already in force here,
		// so its absence must not block a deploy from booting.
		expect(env.ALLOW_DEV_AUTH).toBeUndefined();
		expect(() => validateEnv()).not.toThrow();
	});

	it('passes on a complete production environment', () => {
		completeProductionEnv();
		expect(() => validateEnv()).not.toThrow();
	});

	it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY'])('rejects production without %s', (key) => {
		completeProductionEnv();
		delete env[key];
		expect(() => validateEnv()).toThrow(key);
	});

	it('rejects production with no email transport', () => {
		completeProductionEnv();
		delete env.RESEND_API_KEY;
		expect(() => validateEnv()).toThrow('No email transport configured');
	});

	it('does not impose the production checks on a preview deploy', () => {
		completeProductionEnv();
		env.VERCEL_ENV = 'preview';
		delete env.RESEND_API_KEY;
		delete env.SUPABASE_URL;

		// Preview exists to review UI; its outbound mail is already fenced to
		// yopmail addresses, so a missing provider there isn't a boot failure.
		expect(() => validateEnv()).not.toThrow();
	});
});
