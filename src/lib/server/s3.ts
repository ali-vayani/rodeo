/**
 * The one place this app talks to S3.
 *
 * Every `@aws-sdk` import lives here. The previous Rodeo spread five separate
 * `new S3Client(...)` instances across `s3Handler.ts`, three tRPC routers and a
 * route handler, each re-reading the bucket name and region for itself — so
 * "where do we get files from" had five answers, and the shared helper module
 * that was supposed to be the answer had exactly one caller. Keeping the SDK
 * behind one module also keeps a ~20 MB dependency out of every other module's
 * import graph, and makes the whole thing mockable in one `vi.mock`.
 *
 * Nothing here is boot-critical. Every accessor answers "is this configured?"
 * with a boolean or a `null` and never an exception, so a deploy with no bucket
 * simply cannot offer uploads — the same contract `wallet/config.ts` keeps, and
 * for the same reason: file uploads are one question on a form, and they must
 * never be able to take the form down with them.
 *
 * Values are read lazily inside each function rather than captured at module
 * load, because `$env/dynamic/private` is populated at runtime and a frozen value
 * would be wrong under `vite preview` and in tests that set the variable
 * themselves. Same reasoning as `deployEnv()` and `wallet/config.ts`.
 */

import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

/**
 * The four variables that decide whether uploads exist.
 *
 * Deliberately NOT the bare `AWS_*` names the previous Rodeo used. Vercel's Node
 * runtime sets `AWS_REGION` and the Lambda credential variables for the function
 * itself, so an SDK left to its default credential chain silently authenticates
 * as the platform's execution role against the platform's region instead of the
 * bucket you meant — and does it without erroring, which is the part that makes
 * it expensive to find. `model-remote.ts` called this trap in advance and
 * prescribed namespacing every variable; this is that.
 *
 * The credentials are therefore also passed to the client *explicitly* below.
 * Reading them here and handing them over is what stops the default chain from
 * ever being consulted.
 */
const REQUIRED_VARS = [
	'S3_REGION',
	'S3_BUCKET',
	'S3_ACCESS_KEY_ID',
	'S3_SECRET_ACCESS_KEY'
] as const;

export type S3Config = {
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

/**
 * The ceiling on anything uploaded through this module.
 *
 * Vercel caps a serverless function's request body at 4.5 MB, and every upload
 * path we intend to build proxies the bytes through a function. A limit above
 * that would not be a limit — it would be a promise the platform breaks first,
 * with a 413 that never reaches our error handling. 4 MB leaves room for the
 * multipart envelope around the file.
 *
 * One number for the whole project rather than a per-question column: the
 * previous Rodeo had `Question.maxSizeMB` and nothing ever meaningfully varied
 * it, so it bought an extra column and an extra field in the question editor to
 * express a constant.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * How long a presigned download URL stays valid.
 *
 * The URL grants unauthenticated access to whoever holds it — that is the whole
 * point of presigning — so it should outlive the redirect that consumes it and
 * very little else. The previous Rodeo took the SDK default of 900 s for a URL
 * the browser follows within a second of receiving it.
 */
const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * Config, or `null` if the bucket isn't set up on this deploy.
 *
 * Never throws. A caller that gets `null` should not offer the feature.
 */
export function s3Config(): S3Config | null {
	const values = REQUIRED_VARS.map((name) => env[name]);
	if (values.some((value) => !value)) return null;

	const [region, bucket, accessKeyId, secretAccessKey] = values as string[];
	return { region, bucket, accessKeyId, secretAccessKey };
}

/** Whether file storage is available. Callers gate on this before offering an upload. */
export function s3Configured(): boolean {
	return s3Config() !== null;
}

/**
 * The client, built on first use and reused after.
 *
 * Memoized because a warm serverless instance serves many requests and each
 * client sets up its own connection pool, but built lazily rather than at import
 * so the environment is read at runtime.
 *
 * Keyed on the config it was built from, so a test (or a `vite preview` process)
 * that changes the variables gets a client that reflects them instead of one
 * frozen at whatever the first call happened to see.
 */
let cached: { key: string; client: S3Client } | null = null;

function client(config: S3Config): S3Client {
	const key = `${config.region}/${config.bucket}/${config.accessKeyId}`;
	if (cached?.key === key) return cached.client;

	const created = new S3Client({
		region: config.region,
		// Explicit, never the default provider chain — see REQUIRED_VARS.
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		}
	});
	cached = { key, client: created };
	return created;
}

/** Drops the memoized client. Tests only. */
export function resetS3Client(): void {
	cached = null;
}

/**
 * What to say when storage is asked for and no bucket is set up.
 *
 * A named message rather than a bare throw at each call site: this is the error
 * an organizer sees when uploads mysteriously don't work, and it should say what
 * to set.
 */
export const NO_STORAGE_MESSAGE =
	'No file storage configured. Set S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and ' +
	'S3_SECRET_ACCESS_KEY (see .env.example for the IAM policy the key needs).';

/**
 * Config for an operation that cannot proceed without it.
 *
 * The predicate above is for deciding whether to offer a feature; this is for
 * the operations themselves, which are only reached once something has already
 * decided storage exists. Reaching one with no bucket is a bug in that gate, so
 * it throws rather than failing quietly.
 */
function requireConfig(): S3Config {
	const config = s3Config();
	if (!config) throw new Error(NO_STORAGE_MESSAGE);
	return config;
}

/**
 * Write an object, overwriting whatever was at that key.
 *
 * No delete-then-put. `PutObject` already replaces the object atomically, and the
 * previous Rodeo's `s3Upload` issued an *unawaited* `DeleteObjectCommand` first —
 * a race in which the delete could land after the write it was meant to precede
 * and remove the file that had just been uploaded.
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	const config = requireConfig();
	await client(config).send(
		new PutObjectCommand({
			Bucket: config.bucket,
			Key: key,
			Body: body,
			ContentType: contentType
		})
	);
}

/** Read an object into memory. For files small enough to hold — see MAX_UPLOAD_BYTES. */
export async function getObject(key: string): Promise<Buffer> {
	const config = requireConfig();
	const response = await client(config).send(
		new GetObjectCommand({ Bucket: config.bucket, Key: key })
	);

	if (!response.Body) throw new Error(`S3 returned no body for ${key}`);
	return Buffer.from(await response.Body.transformToByteArray());
}

/**
 * Remove an object.
 *
 * S3 treats deleting a key that isn't there as a success, so callers cleaning up
 * after a row that may never have had a file don't need to check first.
 */
export async function deleteObject(key: string): Promise<void> {
	const config = requireConfig();
	await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/**
 * A short-lived URL that downloads an object.
 *
 * `filename` sets `Content-Disposition` on the response. Without it the browser
 * names the download after the key, and our keys are ids — so the previous
 * Rodeo's resumes arrived as a bare cuid with no extension, which Preview and
 * Word both refuse to open. The name is quoted and stripped of quotes and
 * newlines: it originates from a user-supplied upload, and it is being
 * interpolated into an HTTP header.
 *
 * The bucket stays private. This function is the only way anything leaves it,
 * and every caller is expected to have authorised the request first.
 */
export async function signedDownloadUrl(
	key: string,
	options: { filename?: string; expiresIn?: number } = {}
): Promise<string> {
	const config = requireConfig();
	const command = new GetObjectCommand({
		Bucket: config.bucket,
		Key: key,
		...(options.filename && {
			ResponseContentDisposition: `attachment; filename="${sanitiseFilename(options.filename)}"`
		})
	});

	return getSignedUrl(client(config), command, {
		expiresIn: options.expiresIn ?? DOWNLOAD_URL_TTL_SECONDS
	});
}

/**
 * Make a user-supplied name safe to put inside a quoted header parameter.
 *
 * Quotes would end the parameter early and CR/LF would end the header itself, so
 * both are dropped rather than escaped. Path separators go too: a name is a name,
 * and `../` in a `Content-Disposition` is only ever an attempt at something.
 */
function sanitiseFilename(name: string): string {
	const cleaned = name
		.replace(/["\\\r\n]/g, '')
		.replace(/[/]/g, '_')
		.trim();
	return cleaned || 'download';
}

/**
 * Complain at boot about a half-configured bucket.
 *
 * Called from `hooks.server.ts` after `validateEnv()`, and deliberately not part
 * of it. Nothing set is a deliberate off switch; three of four set is a typo,
 * and a typo whose only symptom is "the upload button isn't there" has nothing
 * anywhere to explain itself. Same split as `warnIncompleteWalletConfig`.
 */
export function warnIncompleteS3Config(): void {
	for (const message of s3ConfigWarnings()) console.warn(`[s3] ${message}`);
}

/** The warnings `warnIncompleteS3Config` prints. Separated out to be testable. */
export function s3ConfigWarnings(): string[] {
	const missing = REQUIRED_VARS.filter((name) => !env[name]);

	// All present, or all absent — both are coherent states.
	if (missing.length === 0 || missing.length === REQUIRED_VARS.length) return [];

	return [
		`File storage is partially configured and will stay disabled. Missing: ${missing.join(', ')}.`
	];
}
