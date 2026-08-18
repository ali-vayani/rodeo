/**
 * Google Wallet passes.
 *
 * A "generic" pass carrying the same `User.uid` barcode the on-screen QR code
 * encodes, handed to the browser as a `https://pay.google.com/gp/v/save/<jwt>`
 * link.
 *
 * ## Why the object is inserted server-side instead of inlined in the JWT
 *
 * Google lets you skip the API entirely by embedding whole class and object
 * definitions in the signed JWT — they get created when the user saves. Tempting,
 * and wrong here, because the JWT rides inside the URL and Google documents 1800
 * characters as the safe encoded length. Past that, browsers truncate and the save
 * fails with no error worth reading.
 *
 * The budget doesn't work. An RS256 signature alone is 342 base64 characters. A
 * realistic generic object — barcode, header, subheader, logo URI, two text
 * modules — is 700-1000 bytes of JSON, so ~1300 characters once encoded, and the
 * header pushes it over. It would pass review with a short test name and fail for
 * a hacker with a long one: data-dependent, per-user, and unreproducible by
 * whoever is asked to debug it.
 *
 * Inserting the object first and referencing it as `{ id, classId }` costs ~110
 * bytes of payload, so the finished JWT is around 700 characters and — the part
 * that actually matters — a *constant* size regardless of anybody's name.
 *
 * The better reason is that a stored object stays mutable. `genericobject.patch`
 * updates a pass already sitting in someone's phone, so check-in status or a team
 * name can change after the fact. A JWT-inlined object is write-once.
 *
 * ## Why `google-auth-library` and not `googleapis`
 *
 * We need one OAuth access token and three REST calls. `googleapis` is a ~50 MB
 * metapackage and even `@googleapis/walletobjects` is a generated client wrapping
 * requests we can write by hand in twenty lines; either would be paid for on every
 * serverless cold start. The token is worth a dependency because refresh and clock
 * skew are fiddly. The save JWT is signed with `node:crypto` directly, so
 * `jsonwebtoken` isn't needed either.
 *
 * The previous Rodeo's attempt at this (commented out on branch `144-google-wallet`)
 * read a misspelled `GOOGLE_APPLICATIONS_CREDENTIALS` and passed a parsed JSON
 * object as `keyFile`, which wants a filesystem path. Neither could have worked.
 */

import { createSign } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { googleWalletCredentials, type GoogleWalletCredentials } from './config';

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const SAVE_URL = 'https://pay.google.com/gp/v/save';

/**
 * Google's documented safe length for the encoded JWT, because it travels in a URL.
 *
 * Asserted in tests rather than enforced at runtime: if a change ever pushes the
 * payload over this, the build should fail, not one hacker's phone.
 */
export const SAFE_JWT_LENGTH = 1800;

export type GooglePassSubject = {
	uid: string;
	name: string;
	group: string | null;
};

/**
 * Resource ids may only contain these characters.
 *
 * `User.uid` is a cuid and already complies, but it is user-adjacent data being
 * interpolated into a URL path, and "already complies" is a property of today's id
 * scheme rather than a guarantee.
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

/**
 * Create the pass class if it isn't there.
 *
 * Memoised in a module-scoped promise, so a warm instance pays for this once
 * rather than on every download. A 409 counts as success: two cold starts racing
 * each other is normal and not a problem.
 *
 * Deliberately never updates. Artwork changes are an operator action — see
 * `provisionGoogleWalletClass` — not a side effect of a hacker tapping a button.
 */
let ensured: Promise<void> | null = null;

export function resetGoogleClassMemo(): void {
	ensured = null;
}

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
 * Create or update the hacker's pass object.
 *
 * `POST` then `PATCH` on conflict, rather than `GET` and decide — two concurrent
 * clicks would both read "absent" and both insert.
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
 * Sign the save token.
 *
 * The payload is only `{ id, classId }` — no name, no email, nothing that would
 * otherwise end up in browser history, a referrer header, or a shared link.
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
 * The "Add to Google Wallet" URL for one hacker, or `null` when Google isn't configured.
 *
 * Callers are responsible for having checked eligibility first — this mints a pass
 * for whoever it is handed.
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
 * Rewrite the class definition. Admin-triggered, never automatic.
 *
 * `ensureClass` only ever creates, so artwork and layout changes need an explicit
 * action — otherwise a deploy would silently restyle every pass already in
 * circulation.
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
