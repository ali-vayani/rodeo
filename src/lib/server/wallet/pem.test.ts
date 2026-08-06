import { describe, it, expect } from 'vitest';
import { normalisePem, certificateExpiry, certificateIsCurrent } from './pem';
import { EXPIRED_CERT_PEM, LONG_LIVED_CERT_PEM } from './test-fixtures/certificates';

const label = 'APPLE_PASS_SIGNER_CERT';

describe('normalisePem', () => {
	it('passes raw PEM through unchanged', () => {
		expect(normalisePem(LONG_LIVED_CERT_PEM, label)).toBe(LONG_LIVED_CERT_PEM.trim());
	});

	it('unescapes literal \\n sequences', () => {
		// What the Vercel dashboard stores when a multi-line value is pasted in.
		const escaped = LONG_LIVED_CERT_PEM.trim().replace(/\n/g, '\\n');
		expect(escaped).not.toContain('\n');
		expect(normalisePem(escaped, label)).toBe(LONG_LIVED_CERT_PEM.trim());
	});

	it('decodes base64-encoded PEM', () => {
		// The recommended way to set these: one line, no dashes, no spaces, nothing
		// left for a text field to mangle.
		const b64 = Buffer.from(LONG_LIVED_CERT_PEM.trim(), 'utf8').toString('base64');
		expect(normalisePem(b64, label)).toBe(LONG_LIVED_CERT_PEM.trim());
	});

	it('decodes base64 of already-escaped PEM', () => {
		// Belt and braces: someone escapes the newlines, then base64s the result.
		const escaped = LONG_LIVED_CERT_PEM.trim().replace(/\n/g, '\\n');
		const b64 = Buffer.from(escaped, 'utf8').toString('base64');
		expect(normalisePem(b64, label)).toBe(LONG_LIVED_CERT_PEM.trim());
	});

	it('tolerates surrounding whitespace', () => {
		expect(normalisePem(`\n  ${LONG_LIVED_CERT_PEM.trim()}  \n`, label)).toBe(
			LONG_LIVED_CERT_PEM.trim()
		);
	});

	it('rejects an empty value', () => {
		expect(() => normalisePem('   ', label)).toThrow(/is empty/);
	});

	it('rejects anything that is not PEM, rather than repairing it', () => {
		// The previous implementation rebuilt mangled `-----BEGIN X-----` delimiters
		// with a regex and substituted `_` back to spaces. Both silently produce a
		// certificate that parses and signs but that iOS then refuses, which is the
		// least debuggable failure available. Fail here instead.
		expect(() => normalisePem('not a certificate', label)).toThrow(/not a PEM/);
		expect(() => normalisePem('—--BEGIN CERTIFICATE—--\nabc\n', label)).toThrow(/not a PEM/);
	});

	it('names the variable in the error so a misconfigured deploy is actionable', () => {
		expect(() => normalisePem('garbage', 'GOOGLE_WALLET_SERVICE_ACCOUNT')).toThrow(
			/GOOGLE_WALLET_SERVICE_ACCOUNT/
		);
	});
});

describe('certificateExpiry', () => {
	it('reads validTo off a certificate', () => {
		expect(certificateExpiry(LONG_LIVED_CERT_PEM, label)).toEqual(
			new Date('2100-01-01T00:00:00.000Z')
		);
		expect(certificateExpiry(EXPIRED_CERT_PEM, label)).toEqual(
			new Date('2021-01-01T00:00:00.000Z')
		);
	});

	it('throws on something that is not a certificate', () => {
		// A private key is PEM and normalises fine, but it is not an X.509 cert.
		expect(() => certificateExpiry('-----BEGIN PRIVATE KEY-----\nabc\n', label)).toThrow(
			/could not be parsed/
		);
	});
});

describe('certificateIsCurrent', () => {
	it('is true for a certificate inside its validity window', () => {
		expect(certificateIsCurrent(LONG_LIVED_CERT_PEM, label)).toBe(true);
	});

	it('is false for an expired certificate', () => {
		// This is the check standing between us and the failure the old repo shipped:
		// node-forge signs happily with an expired cert, and the pass is only refused
		// later, on the device, with no diagnostic anywhere.
		expect(certificateIsCurrent(EXPIRED_CERT_PEM, label)).toBe(false);
	});

	it('takes `now` as a parameter so expiry is testable without faking the clock', () => {
		const duringValidity = new Date('2020-06-01T00:00:00.000Z');
		expect(certificateIsCurrent(EXPIRED_CERT_PEM, label, duringValidity)).toBe(true);
	});
});
