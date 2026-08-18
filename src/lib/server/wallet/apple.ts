/**
 * Apple Wallet passes.
 *
 * A signed `.pkpass` — a zip of the model files plus a manifest and a signature —
 * carrying the same `User.uid` barcode the on-screen QR code encodes.
 *
 * ## The identifiers come from the environment, not from `pass.json`
 *
 * `passTypeIdentifier` and `teamIdentifier` have to agree with the signing
 * certificate or iOS rejects the pass. Reading them from the environment and
 * overriding the template means a certificate reissued under a different team is a
 * configuration change rather than a code change — which matters because these
 * certificates expire annually and the reissue is usually done by whoever is
 * available, not by whoever wrote this.
 *
 * ## Expiry is checked before signing, not after
 *
 * node-forge, underneath passkit-generator, signs perfectly happily with an
 * expired certificate. The `.pkpass` builds, downloads, and is then refused by iOS
 * with "Safari cannot download this file" — no mention of a certificate, nothing
 * in any server log, and the file works fine on the machine of whoever last
 * renewed it. `appleWalletConfigured()` already hides the button; this refuses to
 * build as well, so a direct request to the endpoint gets a real error instead of
 * a file that silently doesn't work.
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
 * Apple's WWDR intermediate.
 *
 * Vendored in the repo because it is public, identical for every developer, and
 * valid until 2030. The override exists only for the eventual G5 transition — the
 * previous Rodeo made this a required variable and filled it with a copy of the
 * *signer* certificate, so that setup could never have produced a valid pass.
 */
async function wwdrCertificate(): Promise<string> {
	const override = env.APPLE_PASS_WWDR_CERT;
	if (override) return normalisePem(override, 'APPLE_PASS_WWDR_CERT');
	return await loadBundledWwdrCertificate();
}

/**
 * Build a signed `.pkpass` for one hacker, or `null` when Apple isn't configured.
 *
 * Callers are responsible for having checked eligibility — this signs a pass for
 * whoever it is handed.
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
