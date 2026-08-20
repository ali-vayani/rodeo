/**
 * Getting PEM certificates out of environment variables intact.
 *
 * A PEM file is multi-line and environment variables are not, so every deploy target
 * mangles them differently. Repairing a mangled certificate is a worse failure mode
 * than refusing one: a corrupted signer key does not fail at load, it fails when an
 * iPhone declines the finished pass.
 *
 * So only two repairs: `\n` unescaping, because Vercel produces it, and base64
 * detection, which is the recommended way to set these since a single base64 line has
 * nothing left to mangle. Anything else throws.
 */

import { X509Certificate } from 'node:crypto';

const PEM_HEADER = /^-----BEGIN [A-Z0-9 ]+-----/;

/**
 * Normalise an environment-variable certificate or key into real PEM text.
 *
 * Accepts raw PEM, `\n`-escaped PEM, base64-of-PEM, and base64-of-escaped-PEM.
 * Throws on anything else rather than guessing.
 */
export function normalisePem(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is empty`);

	const unescaped = unescapeNewlines(trimmed);
	if (PEM_HEADER.test(unescaped)) return unescaped;

	// Not PEM yet, so try it as base64. `Buffer.from` ignores characters outside the
	// base64 alphabet instead of throwing, so the decoded text is checked rather than the
	// input: whether it was base64 is only knowable from what comes out.
	const decoded = unescapeNewlines(Buffer.from(trimmed, 'base64').toString('utf8').trim());
	if (PEM_HEADER.test(decoded)) return decoded;

	throw new Error(
		`${label} is not a PEM certificate or key. Expected text beginning "-----BEGIN", ` +
			'either directly, with \\n escapes, or base64-encoded. Re-export it rather than ' +
			'hand-editing — a partially corrected PEM fails at pass signing, not at startup.'
	);
}

function unescapeNewlines(value: string): string {
	return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

/**
 * When a certificate stops being valid.
 *
 * node-forge will happily sign with an expired certificate, producing a `.pkpass` that
 * iOS rejects with a generic error and nothing in any server log. Checking `validTo`
 * up front converts that into a startup warning and a hidden button.
 */
export function certificateExpiry(pem: string, label: string): Date {
	let cert: X509Certificate;
	try {
		cert = new X509Certificate(pem);
	} catch (cause) {
		throw new Error(`${label} could not be parsed as an X.509 certificate`, { cause });
	}

	const validTo = new Date(cert.validTo);
	if (Number.isNaN(validTo.getTime())) {
		throw new Error(`${label} has an unreadable expiry date: ${cert.validTo}`);
	}
	return validTo;
}

/** Whether a certificate is currently within its validity window. */
export function certificateIsCurrent(pem: string, label: string, now: Date = new Date()): boolean {
	return certificateExpiry(pem, label) > now;
}
