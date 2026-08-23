/**
 * Google Wallet passes: a "generic" pass carrying the same `User.uid` barcode the
 * on-screen QR encodes, handed to the browser as a `pay.google.com/gp/v/save/<jwt>` link.
 *
 * The object is inserted server-side rather than inlined in the JWT. Google allows
 * inlining, but the JWT rides in a URL against a documented safe length of 1800
 * characters, and an RS256 signature alone is 342 while a realistic object is 700-1000
 * bytes of JSON. It would pass review with a short test name and fail for a hacker with
 * a long one. Referencing `{ id, classId }` costs ~110 bytes and is a constant size.
 * A stored object also stays mutable, where a JWT-inlined one is write-once.
 *
 * `google-auth-library` rather than `googleapis`, which is a ~50 MB metapackage paid
 * for on every cold start. We need one OAuth token and three REST calls; the token is
 * worth a dependency because refresh and clock skew are fiddly, and the save JWT is
 * signed with `node:crypto`.
 */

import { createSign } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { googleWalletCredentials, type GoogleWalletCredentials } from './config';

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const SAVE_URL = 'https://pay.google.com/gp/v/save';

/**
 * Google's documented safe length for the encoded JWT. Asserted in tests rather than
 * enforced at runtime: a change that pushes the payload over should fail the build.
 */
export const SAFE_JWT_LENGTH = 1800;

export type GooglePassSubject = {
	uid: string;
	name: string;
	group: string | null;
};

/**
 * Resource ids may only contain these characters. `User.uid` is a cuid and already
 * complies, but it is user-adjacent data being interpolated into a URL path.
 */
function safeId(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, '');
}

function classId(credentials: GoogleWalletCredentials): string {
	return `${credentials.issuerId}.${safeId(credentials.classSuffix)}`;
}

function objectId(credentials: GoogleWalletCredentials, uid: string): string {
	return `${credentials.issuerId}.${safeId(uid)}`;
}

async function accessToken(credentials: GoogleWalletCredentials): Promise<string> {
	const client = new JWT({
		email: credentials.clientEmail,
		key: credentials.privateKey,
		scopes: [SCOPE]
	});
	const { access_token } = await client.authorize();
	if (!access_token)
		throw new Error('Google refused an access token for the wallet service account');
	return access_token;
}

async function walletFetch(
	token: string,
	path: string,
	init: { method: string; body?: unknown } = { method: 'GET' }
): Promise<Response> {
	return await fetch(`${WALLET_API}${path}`, {
		method: init.method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.body ? { 'Content-Type': 'application/json' } : {})
		},
		body: init.body ? JSON.stringify(init.body) : undefined
	});
}

/** The class definition. Sent on creation, and re-sent by the admin re-provision action. */
function classDefinition(credentials: GoogleWalletCredentials) {
	return {
		id: classId(credentials),
		classTemplateInfo: {
			cardTemplateOverride: {
				cardRowTemplateInfos: [
					{
						oneItem: {
							item: {
								firstValue: {
									fields: [{ fieldPath: "object.textModulesData['check-in-code']" }]
								}
							}
						}
					}
				]
			}
		},
		hexBackgroundColor: '#191919'
	};
}

let ensured: Promise<void> | null = null;

export function resetGoogleClassMemo(): void {
	ensured = null;
}

/**
 * Create the pass class if it isn't there. Memoised in `ensured` so a warm instance
 * pays once, and a 409 counts as success since two cold starts racing is normal.
 *
 * Deliberately never updates: artwork changes are an operator action, not a side effect
 * of a hacker tapping a button.
 */
async function ensureClass(credentials: GoogleWalletCredentials, token: string): Promise<void> {
	ensured ??= (async () => {
		const id = classId(credentials);
		const existing = await walletFetch(token, `/genericClass/${id}`);
		if (existing.ok) return;
		if (existing.status !== 404) {
			throw new Error(`Google Wallet class lookup failed with ${existing.status}`);
		}

		const created = await walletFetch(token, '/genericClass', {
			method: 'POST',
			body: classDefinition(credentials)
		});
		// 409 — another instance won the race, which is the outcome we wanted anyway.
		if (!created.ok && created.status !== 409) {
			throw new Error(`Google Wallet class creation failed with ${created.status}`);
		}
	})().catch((error) => {
		// Don't memoise a failure: the next request should be allowed to try again.
		ensured = null;
		throw error;
	});

	return await ensured;
}

function objectDefinition(credentials: GoogleWalletCredentials, user: GooglePassSubject) {
	return {
		id: objectId(credentials, user.uid),
		classId: classId(credentials),
		state: 'ACTIVE',
		// The contract with `resolveUserByCode` in the scan router: this value is the
		// full uid, exactly as the on-screen QR encodes it. Changing it breaks check-in.
		barcode: {
			type: 'QR_CODE',
			value: user.uid,
			alternateText: displayCode(user.uid)
		},
		cardTitle: { defaultValue: { language: 'en-US', value: 'Freetail Hackers' } },
		header: { defaultValue: { language: 'en-US', value: user.name } },
		subheader: { defaultValue: { language: 'en-US', value: 'Hacker badge' } },
		hexBackgroundColor: '#191919',
		textModulesData: [
			{ id: 'check-in-code', header: 'Check-in code', body: displayCode(user.uid) },
			...(user.group ? [{ id: 'group', header: 'Group', body: user.group }] : [])
		]
	};
}

/** The short code shown under the QR on the account page. Kept identical here. */
function displayCode(uid: string): string {
	return 'RC-' + uid.slice(-4).toUpperCase();
}

/**
 * Create or update the hacker's pass object. `POST` then `PATCH` on conflict, rather
 * than `GET` and decide, since two concurrent clicks would both read "absent".
 */
async function upsertObject(
	credentials: GoogleWalletCredentials,
	token: string,
	user: GooglePassSubject
): Promise<void> {
	const body = objectDefinition(credentials, user);
	const created = await walletFetch(token, '/genericObject', { method: 'POST', body });
	if (created.ok) return;

	if (created.status === 409) {
		const patched = await walletFetch(token, `/genericObject/${body.id}`, {
			method: 'PATCH',
			body
		});
		if (!patched.ok) {
			throw new Error(`Google Wallet object update failed with ${patched.status}`);
		}
		return;
	}

	throw new Error(`Google Wallet object creation failed with ${created.status}`);
}

function base64url(input: Buffer | string): string {
	return Buffer.from(input)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * Sign the save token. The payload is only `{ id, classId }` — no name, no email,
 * nothing that would end up in browser history, a referrer header, or a shared link.
 */
function signSaveJwt(credentials: GoogleWalletCredentials, objectResourceId: string): string {
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: credentials.clientEmail,
			aud: 'google',
			typ: 'savetowallet',
			payload: {
				genericObjects: [{ id: objectResourceId, classId: classId(credentials) }]
			}
		})
	);

	const signature = createSign('RSA-SHA256')
		.update(`${header}.${claims}`)
		.sign(credentials.privateKey);

	return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * The "Add to Google Wallet" URL for one hacker, or `null` when Google isn't
 * configured. Callers must have checked eligibility first.
 */
export async function buildGoogleSaveUrl(user: GooglePassSubject): Promise<string | null> {
	const credentials = googleWalletCredentials();
	if (!credentials) return null;

	const token = await accessToken(credentials);
	await ensureClass(credentials, token);
	await upsertObject(credentials, token, user);

	return `${SAVE_URL}/${signSaveJwt(credentials, objectId(credentials, user.uid))}`;
}

/**
 * Rewrite the class definition. Admin-triggered, never automatic: `ensureClass` only
 * creates, so a deploy must not silently restyle every pass already in circulation.
 */
export async function provisionGoogleWalletClass(): Promise<string> {
	const credentials = googleWalletCredentials();
	if (!credentials) throw new Error('Google Wallet is not configured');

	const token = await accessToken(credentials);
	const id = classId(credentials);

	const existing = await walletFetch(token, `/genericClass/${id}`);
	const response = existing.ok
		? await walletFetch(token, `/genericClass/${id}`, {
				method: 'PUT',
				body: classDefinition(credentials)
			})
		: await walletFetch(token, '/genericClass', {
				method: 'POST',
				body: classDefinition(credentials)
			});

	if (!response.ok) {
		throw new Error(`Google Wallet class provisioning failed with ${response.status}`);
	}

	resetGoogleClassMemo();
	return id;
}
