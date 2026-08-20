/**
 * Environment resolution and startup validation.
 *
 * Vercel gives three environments where `NODE_ENV` gives two, and the middle one
 * matters: a preview deploy runs a production build against real credentials. The other
 * job is failing fast at boot when production is missing something it cannot work
 * without.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

export type DeployEnv = 'production' | 'preview' | 'development';

/**
 * `VERCEL_ENV` when deployed, `NODE_ENV` otherwise.
 *
 * Read lazily rather than captured at module load, because `$env/dynamic/private` is
 * populated at runtime.
 */
export function deployEnv(): DeployEnv {
	const vercel = env.VERCEL_ENV;
	if (vercel === 'production' || vercel === 'preview' || vercel === 'development') {
		return vercel;
	}
	return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

/** True only for the real deployment. Preview is not production. */
export function isProduction(): boolean {
	return deployEnv() === 'production';
}

/**
 * Whether Supabase (Google) sign-in is available. Preview counts, being a production
 * build with real credentials. Whether the yopmail bypass is also available is a
 * separate question — see `yopmailLoginEnabled()`.
 */
export function usesSupabaseAuth(): boolean {
	return deployEnv() !== 'development';
}

/**
 * Whether /login may sign in a seeded @yopmail.com account with no password.
 *
 * Development (behind ALLOW_DEV_AUTH and the local-database gate) and preview, never
 * production. Each preview runs against its own throwaway per-branch database and sends
 * no mail, and the bypass only ever reaches @yopmail.com accounts.
 */
export function yopmailLoginEnabled(): boolean {
	return !usesSupabaseAuth() || deployEnv() === 'preview';
}

/**
 * Whether the account switcher may run.
 *
 * On unconditionally for preview, where it grants exactly what the /login yopmail form
 * already does. Everywhere else this is deliberately stricter than `usesSupabaseAuth()`
 * and deliberately redundant with `validateEnv()`, because the switcher is a
 * passwordless login-as-any-account endpoint that renders while signed out.
 *
 * `dev` is a build-time constant, so no runtime variable can turn it back on, and a
 * production deploy never ships the widget at all.
 */
export function devSwitcherEnabled(): boolean {
	if (deployEnv() === 'preview') return true;
	return (
		dev && // built bundles are never dev
		!usesSupabaseAuth() && // production is not development
		env.ALLOW_DEV_AUTH === '1' && // opt-in, never inherited
		databaseIsLocal(env.DATABASE_URL) // never against a remote database
	);
}

/**
 * Whether the second factor on the two whole-database operations is configured.
 *
 * `ADMIN_DATA_PASSWORD` gates the full export and the export-and-wipe: being an admin
 * is not enough for a file holding every applicant's answers, or for destroying them.
 * Unset means both refuse, since "no password configured" must not read as "no password
 * required".
 */
export function dataPasswordConfigured(): boolean {
	return Boolean(env.ADMIN_DATA_PASSWORD);
}

/**
 * Constant-time check. Both sides are hashed first so `timingSafeEqual` gets
 * equal-length buffers, which it requires, and so timing cannot leak the real length.
 */
export function verifyDataPassword(candidate: string): boolean {
	const expected = env.ADMIN_DATA_PASSWORD;
	if (!expected) return false;
	const submitted = createHash('sha256').update(candidate, 'utf8').digest();
	const actual = createHash('sha256').update(expected, 'utf8').digest();
	return timingSafeEqual(submitted, actual);
}

function required(key: string): string {
	const value = env[key];
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
}

const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres'];

/** Whether DATABASE_URL points at a local Postgres. Unparseable counts as non-local. */
function databaseIsLocal(url: string | undefined): boolean {
	if (!url) return false;
	try {
		return LOCAL_DB_HOSTS.includes(new URL(url).hostname);
	} catch {
		return false;
	}
}

/** What to say when mail is asked for and no provider is set up. */
export const NO_EMAIL_MESSAGE =
	'No email transport configured. Set RESEND_API_KEY (Resend dashboard > API Keys), ' +
	'and verify the EMAIL_FROM domain in the same Resend account.';

/**
 * Whether Resend is configured. It is the only transport: the SMTP fallback that used
 * to sit behind it carried stale SES credentials that authenticate against nothing, and
 * a fallback that cannot authenticate is worse than none.
 */
export function resendConfigured(): boolean {
	return Boolean(env.RESEND_API_KEY);
}

/**
 * The From: address on everything the app sends. `||`, not `??`: a Vercel variable
 * left blank arrives as `''`, which Resend rejects on every message, reading as a mail
 * outage with no cause.
 */
export function emailFrom(): string {
	return env.EMAIL_FROM?.trim() || 'hello@freetailhackers.com';
}

/**
 * The public origin, for links that leave the app.
 *
 * A relative href is meaningless in an inbox, and the triggering request is the wrong
 * source: an admin working from a preview would mail everyone links back to that host.
 * `APP_ORIGIN` wins whenever set; the Vercel fallbacks are bare hostnames, so the
 * scheme is ours to add.
 */
export function appOrigin(): string {
	const configured = env.APP_ORIGIN?.trim();
	if (configured) return configured.replace(/\/+$/, '');

	if (isProduction() && env.VERCEL_PROJECT_PRODUCTION_URL) {
		return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
	}
	if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;

	return 'http://localhost:5173';
}

/**
 * Validate the environment at boot. Called once from `hooks.server.ts`. The production
 * checks skip preview, which is useful for reviewing UI with no mail provider and
 * already restricts outbound mail.
 */
export function validateEnv(): void {
	required('DATABASE_URL');

	// The dev bypass has to be asked for, never inherited. `deployEnv()` answers
	// 'development' for anything unrecognised, so a self-hosted `node build` that forgets
	// NODE_ENV=production would otherwise come up serving passwordless logins into a
	// seeded admin account. An explicit opt-in makes that a boot failure instead.
	if (!usesSupabaseAuth() && env.ALLOW_DEV_AUTH !== '1') {
		throw new Error(
			'Refusing to start: this process resolved to the development environment, ' +
				'where /login signs in any @yopmail.com account with no password. ' +
				'Set ALLOW_DEV_AUTH=1 if this really is local development; otherwise set ' +
				'NODE_ENV=production (or VERCEL_ENV) so the deploy authenticates through Supabase.'
		);
	}

	// The bypass plus a remote database is the dangerous combination: passwordless
	// logins against real applicant data. Refuse unless DATABASE_URL is local, so a
	// copied .env pointed at production fails at boot rather than at login.
	if (!usesSupabaseAuth() && env.ALLOW_DEV_AUTH === '1' && !databaseIsLocal(env.DATABASE_URL)) {
		throw new Error(
			'Refusing to start: ALLOW_DEV_AUTH=1 enables passwordless @yopmail.com logins, but ' +
				'DATABASE_URL does not point at a local database. The dev bypass must never run ' +
				'against a remote/production database. Point DATABASE_URL at localhost, or ' +
				'authenticate through Supabase (set NODE_ENV=production / VERCEL_ENV).'
		);
	}

	if (!isProduction()) return;

	required('SUPABASE_URL');
	required('SUPABASE_ANON_KEY');

	if (!resendConfigured()) {
		throw new Error(NO_EMAIL_MESSAGE);
	}
}
