/**
 * Environment resolution and startup validation.
 *
 * Two jobs. First, deciding *which* environment this is — Vercel gives three
 * (production, preview, development) where `NODE_ENV` gives two, and the middle
 * one matters: a preview deploy runs a production build against real credentials,
 * so it must not be allowed to mail real applicants. Second, failing fast when a
 * production deploy is missing something it cannot work without — at boot, rather
 * than on the first hacker who tries to log in.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

export type DeployEnv = 'production' | 'preview' | 'development';

/**
 * `VERCEL_ENV` when deployed, `NODE_ENV` otherwise.
 *
 * Read lazily rather than captured at module load: `$env/dynamic/private` is
 * populated at runtime, and a value frozen at import time would be wrong under
 * `vite preview` and in tests that set the variable themselves.
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
 * Whether Supabase (Google) sign-in is available.
 *
 * Preview counts: previews are production builds with real credentials, and
 * Google login must work there. Whether the yopmail bypass is *also* available
 * is a separate question — `yopmailLoginEnabled()` — because preview deploys
 * run against throwaway per-branch databases of seeded fixtures, not real
 * applicant data.
 *
 * This answers what the environment *looks* like, not whether the dev bypass is
 * permitted: `validateEnv()` additionally demands ALLOW_DEV_AUTH=1 before the
 * app will boot with development auth on.
 */
export function usesSupabaseAuth(): boolean {
	return deployEnv() !== 'development';
}

/**
 * Whether /login may sign in a seeded @yopmail.com account with no password.
 *
 * Development (behind validateEnv's ALLOW_DEV_AUTH and local-database gates)
 * and preview deploys — never production. Preview is deliberate, mirroring the
 * previous Rodeo's staging: every preview runs against its own throwaway
 * per-branch database holding only seeded fixtures, preview sends no outbound
 * mail at all, and reviewers need to walk the admin portal without someone
 * first granting their Google account roles.
 * The bypass still only ever signs into @yopmail.com accounts, so a real
 * person's Google-created account is never reachable through it.
 */
export function yopmailLoginEnabled(): boolean {
	return !usesSupabaseAuth() || deployEnv() === 'preview';
}

/**
 * Whether the account switcher may run.
 *
 * Preview deploys: on, unconditionally. The switcher grants exactly what the
 * /login yopmail form already grants there (`yopmailLoginEnabled`) — enumerate
 * and become seeded fixtures inside a throwaway branch schema — so hiding it
 * there removes convenience, not capability.
 *
 * Everywhere else this is deliberately stricter than `usesSupabaseAuth()`, and
 * deliberately redundant with `validateEnv()`. The switcher is a passwordless
 * login-as-any-account endpoint that renders while signed out — a strictly larger
 * capability than /login, which at least makes you know an address. Re-asserting
 * every condition here means loosening `validateEnv()` later cannot silently open
 * this door.
 *
 * `dev` matters most on that branch: it is a build-time constant, so no runtime
 * environment variable — a self-hosted `node build` with NODE_ENV unset — can turn
 * it back on. The other three catch a `vite dev` process that has been pointed
 * somewhere it shouldn't be. And a production deploy never even ships the widget:
 * vite.config.ts empties `src/lib/dev/` out of VERCEL_ENV=production builds.
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
 * `ADMIN_DATA_PASSWORD` gates the full export and the export-and-wipe. Being an
 * admin is not enough for either: one hands over every applicant's name, email
 * and answers in a single file, and the other destroys them. The password is a
 * deliberate second step — a shared secret held outside the app, so a hijacked
 * admin session cannot exfiltrate or erase the database on its own.
 *
 * Unset means both operations refuse. Failing closed is the only safe default:
 * treating "no password configured" as "no password required" would turn a
 * missing variable into an open door, which is the exact mistake `ALLOW_DEV_AUTH`
 * exists to prevent elsewhere in this file.
 */
export function dataPasswordConfigured(): boolean {
	return Boolean(env.ADMIN_DATA_PASSWORD);
}

/**
 * Constant-time check of a submitted password.
 *
 * Both sides are hashed first so `timingSafeEqual` gets equal-length buffers —
 * it throws otherwise — and so the comparison time cannot leak the length of the
 * real password the way comparing raw buffers would.
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
 * Whether Resend is configured.
 *
 * Resend is the only transport. There used to be a nodemailer SMTP fallback
 * behind it, carried over from the previous Rodeo, and it was never once
 * reached: Resend wins whenever `RESEND_API_KEY` is set, and it is set in every
 * deployed environment. The `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASS` values that
 * sat behind it were stale Amazon SES credentials left over from before the
 * previous Rodeo moved to Resend — SES rejects them with `535 Authentication
 * Credentials Invalid`. Keeping a fallback that cannot authenticate is worse
 * than having none, so the branch is gone rather than merely deprioritised.
 */
export function resendConfigured(): boolean {
	return Boolean(env.RESEND_API_KEY);
}

/**
 * The From: address on everything the app sends.
 *
 * `||`, not `??`: a variable created in Vercel and left blank arrives as `''`, which
 * `??` passes straight through as the envelope sender. Resend rejects that with "The
 * domain is invalid" — on every message, with the lifecycle callers logging the
 * failure and carrying on, so a blank value reads as a mail outage with no cause.
 */
export function emailFrom(): string {
	return env.EMAIL_FROM?.trim() || 'hello@freetailhackers.com';
}

/**
 * The public origin, for links that leave the app — currently email.
 *
 * A relative href is meaningless in an inbox, and the request that triggered a
 * send is the wrong source for this: an admin working from a preview deployment
 * or a `vercel.app` hostname would mail every recipient links back to whatever
 * host that admin happened to be on. `APP_ORIGIN` is the canonical answer and
 * wins whenever it is set.
 *
 * The Vercel fallbacks exist so a deploy that forgets it still produces working
 * links: `VERCEL_PROJECT_PRODUCTION_URL` is the stable production hostname, and
 * `VERCEL_URL` is the per-deployment one, correct for a preview build. Both are
 * bare hostnames, so the scheme is ours to add.
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
 * Validate the environment at boot. Called once from `hooks.server.ts`.
 *
 * The production checks deliberately don't apply to preview: a preview deploy is
 * useful for reviewing UI without a mail provider attached, and its outbound mail
 * is already restricted to yopmail addresses.
 */
export function validateEnv(): void {
	required('DATABASE_URL');

	// The dev bypass has to be asked for, never inherited. `deployEnv()` answers
	// 'development' for anything that isn't a recognised VERCEL_ENV, so a
	// self-hosted `node build` that forgets NODE_ENV=production would otherwise
	// come up serving passwordless logins — and the seed creates
	// admin1@yopmail.com with Role.ADMIN. Requiring an explicit opt-in makes a
	// forgotten variable a boot failure instead of an unlocked front door.
	if (!usesSupabaseAuth() && env.ALLOW_DEV_AUTH !== '1') {
		throw new Error(
			'Refusing to start: this process resolved to the development environment, ' +
				'where /login signs in any @yopmail.com account with no password. ' +
				'Set ALLOW_DEV_AUTH=1 if this really is local development; otherwise set ' +
				'NODE_ENV=production (or VERCEL_ENV) so the deploy authenticates through Supabase.'
		);
	}

	// The bypass and a remote database together are the dangerous combination: passwordless
	// @yopmail.com logins against real applicant data. Even with ALLOW_DEV_AUTH=1 set on
	// purpose, refuse to run the bypass unless DATABASE_URL is local — mirroring the seed
	// guard, so a copied .env pointed at production Supabase fails at boot, not at login.
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
