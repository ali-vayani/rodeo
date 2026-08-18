import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

// `dev` is a build-time constant in the real app, so it has no runtime setter to
// stub. A getter over a local lets the devSwitcherEnabled tests flip it, which is
// the only way to prove the build-time layer of the gate is load-bearing.
let devFlag = true;
vi.mock('$app/environment', () => ({
	get dev() {
		return devFlag;
	}
}));

const {
	deployEnv,
	isProduction,
	usesSupabaseAuth,
	yopmailLoginEnabled,
	resendConfigured,
	emailFrom,
	validateEnv,
	devSwitcherEnabled
} = await import('./env');

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.stubEnv('NODE_ENV', 'development');
	devFlag = true;
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
		// Preview still authenticates through Supabase; the yopmail bypass there
		// is an *additional* door, gated separately by yopmailLoginEnabled.
		expect(usesSupabaseAuth()).toBe(true);
	});
});

describe('yopmailLoginEnabled', () => {
	it('is on in development', () => {
		expect(yopmailLoginEnabled()).toBe(true);
	});

	it('is on for preview deploys', () => {
		// Previews run against throwaway per-branch databases seeded with
		// fixtures, mirroring the previous Rodeo's staging behavior.
		env.VERCEL_ENV = 'preview';
		expect(yopmailLoginEnabled()).toBe(true);
	});

	it('is never on in production', () => {
		env.VERCEL_ENV = 'production';
		expect(yopmailLoginEnabled()).toBe(false);
	});
});

describe('resendConfigured', () => {
	it('is false when nothing is configured', () => {
		expect(resendConfigured()).toBe(false);
	});

	it('needs only the key', () => {
		env.RESEND_API_KEY = 'key';
		expect(resendConfigured()).toBe(true);
	});

	it('is not satisfied by the leftover SMTP variables', () => {
		// Stale Amazon SES credentials, still in Vercel Production. They are not a
		// transport — SES rejects them — so they must not read as one.
		env.EMAIL_HOST = 'email-smtp.us-east-1.amazonaws.com';
		env.EMAIL_USER = 'AKIAEXAMPLE';
		env.EMAIL_PASS = 'stale';

		expect(resendConfigured()).toBe(false);
	});
});

describe('emailFrom', () => {
	it('defaults to the Freetail address', () => {
		expect(emailFrom()).toBe('hello@freetailhackers.com');
	});

	it('honours a configured address', () => {
		env.EMAIL_FROM = 'rodeo@freetailhackers.com';
		expect(emailFrom()).toBe('rodeo@freetailhackers.com');
	});

	it('falls back when EMAIL_FROM is set but blank', () => {
		// A variable created in Vercel and left empty arrives as ''. Under `??` that was
		// passed through as the envelope sender and Resend rejected every message with
		// "The domain is invalid" — confirmed against the live API, not hypothesised.
		env.EMAIL_FROM = '';
		expect(emailFrom()).toBe('hello@freetailhackers.com');

		env.EMAIL_FROM = '   ';
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

describe('devSwitcherEnabled', () => {
	/** The one configuration the switcher is allowed to run in. */
	function workingDevEnv() {
		devFlag = true;
		env.ALLOW_DEV_AUTH = '1';
		env.DATABASE_URL = 'postgres://localhost:5432/rodeo';
	}

	it('allows a local dev server that opted in', () => {
		workingDevEnv();
		expect(devSwitcherEnabled()).toBe(true);
	});

	// Each of the four conditions is removed on its own, so a test fails the moment
	// anyone drops one from the predicate. This gate is the whole security story for
	// a passwordless login-as-anyone endpoint, so it is worth spelling out.
	it('refuses when `dev` is false, whatever the environment says', () => {
		workingDevEnv();
		devFlag = false;

		// The self-hosted `node build` with NODE_ENV unset: deployEnv() falls through
		// to 'development' and every runtime check passes, so the build-time constant
		// is the only thing standing between that deploy and an open door.
		expect(usesSupabaseAuth()).toBe(false);
		expect(devSwitcherEnabled()).toBe(false);
	});

	it('allows preview deploys, with no other conditions', () => {
		// Previews run against throwaway per-branch schemas of seeded fixtures,
		// where the switcher grants nothing the /login yopmail form doesn't
		// already grant — so it is on there even in a built (non-dev) bundle.
		devFlag = false;
		env.VERCEL_ENV = 'preview';
		expect(devSwitcherEnabled()).toBe(true);
	});

	it('refuses in production', () => {
		workingDevEnv();
		env.VERCEL_ENV = 'production';
		expect(devSwitcherEnabled()).toBe(false);
	});

	it('refuses without an explicit ALLOW_DEV_AUTH opt-in', () => {
		workingDevEnv();
		delete env.ALLOW_DEV_AUTH;
		expect(devSwitcherEnabled()).toBe(false);
	});

	it('refuses against a remote database', () => {
		workingDevEnv();
		env.DATABASE_URL = 'postgres://user:pw@db.abcdefg.supabase.co:5432/postgres';

		// The realistic local incident: a developer points DATABASE_URL at production
		// to debug a data issue. validateEnv() would catch this too — but only while
		// VERCEL_ENV is unset, so the switcher re-checks rather than inheriting it.
		expect(devSwitcherEnabled()).toBe(false);
	});

	it('refuses a DATABASE_URL it cannot parse', () => {
		workingDevEnv();
		env.DATABASE_URL = 'not a url';
		expect(devSwitcherEnabled()).toBe(false);
	});
});
