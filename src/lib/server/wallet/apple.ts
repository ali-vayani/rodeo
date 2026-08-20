/**
 * Apple Wallet passes: a signed `.pkpass` carrying the same `User.uid` barcode the
 * on-screen QR encodes.
 *
 * The identifiers come from the environment rather than `pass.json`, because
 * `passTypeIdentifier` and `teamIdentifier` must agree with the signing certificate or
 * iOS rejects the pass. A certificate reissued under a different team is then a config
 * change rather than a code change.
 *
 * Expiry is checked before signing. node-forge signs happily with an expired
 * certificate, producing a `.pkpass` that iOS refuses with "Safari cannot download this
 * file" and nothing in any server log.
 */

import { PKPass } from 'passkit-generator';
import { env } from '$env/dynamic/private';
import { appleWalletCredentials, appleWalletConfigured } from './config';
import { loadPassModel } from './model';
import { loadBundledWwdrCertificate } from './model-local';
import { normalisePem } from './pem';

export type ApplePassSubject = {
	uid: string;
	name: string;
	group: string | null;
};

export type ApplePassContext = {
	/** Shown as the pass's relevant date, so it surfaces on the lock screen that day. */
	hackathonStartDate?: Date | null;
};

/** The short code shown under the QR on the account page. Kept identical here. */
function displayCode(uid: string): string {
	return 'RC-' + uid.slice(-4).toUpperCase();
}

/**
 * Apple's WWDR intermediate. Vendored because it is public, identical for every
 * developer, and valid until 2030. The override exists for the eventual G5 transition.
 */
async function wwdrCertificate(): Promise<string> {
	const override = env.APPLE_PASS_WWDR_CERT;
	if (override) return normalisePem(override, 'APPLE_PASS_WWDR_CERT');
	return await loadBundledWwdrCertificate();
}

/**
 * Build a signed `.pkpass` for one hacker, or `null` when Apple isn't configured.
 * Callers are responsible for having checked eligibility.
 */
export async function buildApplePass(
	user: ApplePassSubject,
	context: ApplePassContext = {}
): Promise<Buffer | null> {
	if (!appleWalletConfigured()) return null;

	const credentials = appleWalletCredentials();
	if (!credentials) return null;

	const [model, wwdr] = await Promise.all([loadPassModel(), wwdrCertificate()]);

	const pass = new PKPass(
		model,
		{
			wwdr,
			signerCert: credentials.signerCert,
			signerKey: credentials.signerKey,
			signerKeyPassphrase: credentials.signerKeyPassphrase
		},
		{
			// Per-hacker, and stable: re-downloading replaces the pass already in
			// Wallet rather than stacking a second copy beside it.
			serialNumber: user.uid,
			passTypeIdentifier: credentials.passTypeIdentifier,
			teamIdentifier: credentials.teamIdentifier,
			logoText: 'Freetail Hackers',
			...(context.hackathonStartDate
				? { relevantDate: context.hackathonStartDate.toISOString() }
				: {})
		}
	);

	// The contract with `resolveUserByCode` in the scan router: the message is the
	// full uid, exactly as the on-screen QR encodes it. Changing it breaks check-in.
	pass.setBarcodes({
		message: user.uid,
		format: 'PKBarcodeFormatQR',
		messageEncoding: 'iso-8859-1',
		altText: displayCode(user.uid)
	});

	pass.headerFields.push({
		key: 'code',
		label: 'CODE',
		value: displayCode(user.uid),
		textAlignment: 'PKTextAlignmentRight'
	});

	pass.secondaryFields.push({
		key: 'attendee',
		label: 'ATTENDEE',
		value: user.name
	});

	if (user.group) {
		pass.secondaryFields.push({
			key: 'group',
			label: 'GROUP',
			value: user.group
		});
	}

	return pass.getAsBuffer();
}

/** The filename offered to the browser. */
export function applePassFilename(uid: string): string {
	return `${displayCode(uid)}.pkpass`;
}
