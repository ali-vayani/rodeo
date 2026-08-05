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

import { env } from '$env/dynamic/private';

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
 * Whether to authenticate through Supabase rather than the yopmail dev bypass.
 *
 * Preview counts. A preview deploy runs against the production database, so a
 * cookie-only bypass there would be an unauthenticated door into real applicant
 * data — the bypass exists for localhost and nowhere else.
 *
 * This answers what the environment *looks* like, not whether the bypass is
 * permitted: `validateEnv()` additionally demands ALLOW_DEV_AUTH=1 before the
 * app will boot with it on.
 */
export function usesSupabaseAuth(): boolean {
	return deployEnv() !== 'development';
}

function required(key: string): string {
	const value = env[key];
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
}

/**
 * Whether an email transport is configured, and which one.
 *
 * Resend wins when both are present — it is the provider the previous Rodeo
 * settled on, and SMTP stays as the escape hatch for a self-hosted deploy.
 */
export function emailTransport(): 'resend' | 'smtp' | null {
	if (env.RESEND_API_KEY) return 'resend';
	if (env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASS) return 'smtp';
	return null;
}

/** The From: address on everything the app sends. */
export function emailFrom(): string {
	return env.EMAIL_FROM ?? 'hello@freetailhackers.com';
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

	if (!isProduction()) return;

	required('SUPABASE_URL');
	required('SUPABASE_ANON_KEY');

	if (!emailTransport()) {
		throw new Error(
			'No email transport configured. Set RESEND_API_KEY, or all of ' +
				'EMAIL_HOST / EMAIL_USER / EMAIL_PASS for SMTP.'
		);
	}
}
