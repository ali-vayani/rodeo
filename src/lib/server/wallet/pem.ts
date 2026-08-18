/**
 * Getting PEM certificates out of environment variables intact.
 *
 * A PEM file is multi-line, and environment variables are not, so every deploy
 * target mangles them differently: Vercel's dashboard stores literal `\n`
 * two-character sequences, `.env` files need the whole thing quoted or dotenv
 * stops at the first newline, and a copy-paste through a rich-text field turns
 * `-----` into an em dash. The previous Rodeo accumulated a `formatCert()` that
 * tried to undo all of it at once — unescaping `\n`, substituting `_` back to
 * spaces, replacing em dashes, and rebuilding the `-----BEGIN X-----` delimiters
 * with a regex.
 *
 * Most of that is not carried over, because repairing a mangled certificate is a
 * worse failure mode than refusing one. `.replace(/_/g, ' ')` in particular will
 * silently corrupt any base64 body it touches, and a corrupted signer key does
 * not fail at load — it fails when an iPhone declines the finished pass, which is
 * the least debuggable moment available.
 *
 * What survives:
 *
 *   - `\n` unescaping, because Vercel genuinely produces it.
 *   - base64 detection, which is the *recommended* way to set these. A single
 *     base64 line has no newlines, no dashes and no spaces, so there is nothing
 *     left for a text field to mangle. Prefer it everywhere.
 *
 * Anything that still doesn't look like PEM afterwards throws.
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

	// Not PEM yet — try it as base64. `Buffer.from` ignores characters outside the
	// base64 alphabet instead of throwing, so the decoded text is checked rather
	// than the input: whether it *was* base64 is only knowable from what comes out.
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
 * Needed because node-forge, underneath passkit-generator, will happily sign with
 * an expired certificate. The `.pkpass` builds, downloads, and is then rejected by
 * iOS with a generic "Safari cannot download this file" — no mention of the
 * certificate, nothing in any server log, and the same file works fine on the
 * machine of whoever last renewed it. Checking `validTo` up front converts that
 * into a startup warning and a hidden button.
 *
 * `X509Certificate` comes from `node:crypto`, so this costs no dependency.
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
