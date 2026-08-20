/**
 * Wallet pass configuration, and why none of it lives in `env.ts`.
 *
 * `validateEnv()` throws at module scope, so anything it requires is a condition for
 * the site existing at all. Wallet credentials do not earn that: a missing Apple
 * certificate should take away one button, not the hacker portal and the application
 * form with it. Apple pass certificates also expire annually, so wiring them into
 * `validateEnv()` would mean the site refuses to boot on renewal day.
 *
 * So every accessor here answers "is this configured?" with a boolean or a `null`,
 * never an exception. The one thing that does get shouted about is partial
 * configuration: fully absent is a deliberate off switch, half-present is a typo.
 *
 * Values are read lazily inside each function rather than captured at module load,
 * because `$env/dynamic/private` is populated at runtime.
 */

import { env } from '$env/dynamic/private';
import { isProduction } from '$lib/server/env';
import { certificateIsCurrent, normalisePem } from './pem';

export type AppleWalletCredentials = {
	signerCert: string;
	signerKey: string;
	signerKeyPassphrase: string | undefined;
	passTypeIdentifier: string;
	teamIdentifier: string;
};

export type GoogleWalletCredentials = {
	clientEmail: string;
	privateKey: string;
	issuerId: string;
	classSuffix: string;
};

/** Where the `.pkpass` model files come from. */
export type PassAssetSource = 'local' | 'remote';

/**
 * Apple credentials, or `null` if they aren't all present.
 *
 * Throws only when a value *is* set and is unusable — a garbled certificate is a
 * deployment mistake worth surfacing, whereas an unset one is a choice.
 */
export function appleWalletCredentials(): AppleWalletCredentials | null {
	const signerCert = env.APPLE_PASS_SIGNER_CERT;
	const signerKey = env.APPLE_PASS_SIGNER_KEY;
	const passTypeIdentifier = env.APPLE_PASS_TYPE_IDENTIFIER;
	const teamIdentifier = env.APPLE_PASS_TEAM_IDENTIFIER;

	if (!signerCert || !signerKey || !passTypeIdentifier || !teamIdentifier) return null;

	return {
		signerCert: normalisePem(signerCert, 'APPLE_PASS_SIGNER_CERT'),
		signerKey: normalisePem(signerKey, 'APPLE_PASS_SIGNER_KEY'),
		signerKeyPassphrase: env.APPLE_PASS_SIGNER_KEY_PASSPHRASE || undefined,
		passTypeIdentifier,
		teamIdentifier
	};
}

/**
 * Whether Apple passes can actually be issued right now.
 *
 * Deliberately stricter than "the variables are set". An expired signer certificate
 * produces a `.pkpass` that builds, downloads, and is then refused by iOS with no
 * diagnostic anywhere, so expiry is part of "configured".
 */
export function appleWalletConfigured(now: Date = new Date()): boolean {
	let credentials: AppleWalletCredentials | null;
	try {
		credentials = appleWalletCredentials();
	} catch {
		// A malformed certificate is reported by `warnIncompleteWalletConfig`; this
		// predicate's job is only to keep the button hidden.
		return false;
	}
	if (!credentials) return false;

	return certificateIsCurrent(credentials.signerCert, 'APPLE_PASS_SIGNER_CERT', now);
}

/**
 * Google credentials, or `null` if they aren't all present.
 *
 * The service account arrives as base64 of the whole JSON key file, single line. Raw
 * multi-line JSON pasted into `.env` unquoted makes dotenv read the first line, a bare
 * `{`, and stop. Base64 removes the entire class of problem.
 */
export function googleWalletCredentials(): GoogleWalletCredentials | null {
	const serviceAccount = env.GOOGLE_WALLET_SERVICE_ACCOUNT;
	const issuerId = env.GOOGLE_WALLET_ISSUER_ID;
	const classSuffix = env.GOOGLE_WALLET_CLASS_SUFFIX;

	if (!serviceAccount || !issuerId || !classSuffix) return null;

	const { client_email, private_key } = parseServiceAccount(serviceAccount);
	return {
		clientEmail: client_email,
		privateKey: normalisePem(private_key, 'GOOGLE_WALLET_SERVICE_ACCOUNT.private_key'),
		issuerId,
		classSuffix
	};
}

function parseServiceAccount(value: string): { client_email: string; private_key: string } {
	const trimmed = value.trim();
	// Accept raw JSON too, so a local `.env` with a single-quoted blob still works.
	const json = trimmed.startsWith('{')
		? trimmed
		: Buffer.from(trimmed, 'base64').toString('utf8').trim();

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (cause) {
		throw new Error(
			'GOOGLE_WALLET_SERVICE_ACCOUNT is not valid JSON. Set it to base64 of the whole ' +
				'service-account key file, on one line: `base64 -i key.json`. Pasting the raw ' +
				'multi-line JSON into a .env file truncates it at the first newline.',
			{ cause }
		);
	}

	const account = parsed as { client_email?: unknown; private_key?: unknown };
	if (typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
		throw new Error(
			'GOOGLE_WALLET_SERVICE_ACCOUNT is missing client_email or private_key. Use the ' +
				'unmodified key file downloaded from the Google Cloud console.'
		);
	}
	return { client_email: account.client_email, private_key: account.private_key };
}

/** Whether Google passes can be issued. */
export function googleWalletConfigured(): boolean {
	try {
		return googleWalletCredentials() !== null;
	} catch {
		return false;
	}
}

/**
 * Where to load the `.pkpass` model files from.
 *
 * The explicit override exists so the remote path can be exercised locally. Otherwise
 * a production-only branch is only ever executed in production.
 */
export function passAssetSource(): PassAssetSource {
	const override = env.WALLET_ASSETS_SOURCE;
	if (override === 'local' || override === 'remote') return override;
	return isProduction() && env.WALLET_ASSETS_BASE_URL ? 'remote' : 'local';
}

/** Base URL for remotely-hosted model files, without a trailing slash. */
export function walletAssetsBaseUrl(): string | null {
	const base = env.WALLET_ASSETS_BASE_URL;
	return base ? base.replace(/\/+$/, '') : null;
}

/**
 * Complain about half-configured providers at boot.
 *
 * Called after `validateEnv()` and deliberately not part of it, because this warns and
 * never throws. A provider with nothing set is switched off on purpose. Three of four
 * variables set is a typo that would otherwise present as a missing button.
 */
export function warnIncompleteWalletConfig(): void {
	for (const message of walletConfigWarnings()) console.warn(`[wallet] ${message}`);
}

/** The warnings `warnIncompleteWalletConfig` prints. Separated out to be testable. */
export function walletConfigWarnings(now: Date = new Date()): string[] {
	const warnings: string[] = [];

	const apple = {
		APPLE_PASS_SIGNER_CERT: env.APPLE_PASS_SIGNER_CERT,
		APPLE_PASS_SIGNER_KEY: env.APPLE_PASS_SIGNER_KEY,
		APPLE_PASS_TYPE_IDENTIFIER: env.APPLE_PASS_TYPE_IDENTIFIER,
		APPLE_PASS_TEAM_IDENTIFIER: env.APPLE_PASS_TEAM_IDENTIFIER
	};
	warnings.push(...partialConfigWarning('Apple Wallet', apple));

	const google = {
		GOOGLE_WALLET_SERVICE_ACCOUNT: env.GOOGLE_WALLET_SERVICE_ACCOUNT,
		GOOGLE_WALLET_ISSUER_ID: env.GOOGLE_WALLET_ISSUER_ID,
		GOOGLE_WALLET_CLASS_SUFFIX: env.GOOGLE_WALLET_CLASS_SUFFIX
	};
	warnings.push(...partialConfigWarning('Google Wallet', google));

	// Unusable values, reported separately from missing ones — these are set, so
	// somebody meant them to work.
	try {
		const credentials = appleWalletCredentials();
		if (credentials && !certificateIsCurrent(credentials.signerCert, 'cert', now)) {
			warnings.push(
				'Apple Wallet is disabled: the pass signing certificate has expired. Reissue it ' +
					'in the Apple Developer portal — passes signed with it build successfully and ' +
					'are then rejected by iOS with no error message.'
			);
		}
	} catch (error) {
		warnings.push(`Apple Wallet is disabled: ${(error as Error).message}`);
	}

	try {
		googleWalletCredentials();
	} catch (error) {
		warnings.push(`Google Wallet is disabled: ${(error as Error).message}`);
	}

	return warnings;
}

function partialConfigWarning(
	provider: string,
	variables: Record<string, string | undefined>
): string[] {
	const missing = Object.entries(variables)
		.filter(([, value]) => !value)
		.map(([name]) => name);

	// All present, or all absent — both are coherent states.
	if (missing.length === 0 || missing.length === Object.keys(variables).length) return [];

	return [
		`${provider} is partially configured and will stay disabled. Missing: ${missing.join(', ')}.`
	];
}
