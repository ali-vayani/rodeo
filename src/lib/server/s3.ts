/**
 * The one place this app talks to S3.
 *
 * Every `@aws-sdk` import lives here, keeping a ~20 MB dependency out of every other
 * module's import graph and making the whole thing mockable in one `vi.mock`.
 *
 * Nothing here is boot-critical: every accessor answers "is this configured?" with a
 * boolean or a `null`, so a deploy with no bucket simply cannot offer uploads. Values
 * are read lazily, because `$env/dynamic/private` is populated at runtime.
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
 * The four variables that decide whether uploads exist. These are the names the deploy
 * already carries.
 *
 * `S3_BUCKET` is what makes this list mean anything: Vercel's runtime sets `AWS_REGION`
 * and the Lambda credentials for the function itself, so the three `AWS_*` are present
 * whether or not anyone configured a bucket. The credentials are passed to the client
 * explicitly below for the same reason — an SDK left to its default chain would
 * authenticate as the platform's execution role rather than erroring.
 */
const REQUIRED_VARS = [
	'AWS_REGION',
	'S3_BUCKET',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY'
] as const;

export type S3Config = {
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

/**
 * The ceiling on anything uploaded through this module. Vercel caps a function's
 * request body at 4.5 MB and every upload path proxies bytes through a function, so a
 * higher limit would be a promise the platform breaks first with an unhandled 413.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * How long a presigned download URL stays valid. It grants unauthenticated access to
 * whoever holds it, so it should outlive the redirect that consumes it and little else.
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
 * Lists the storage variables this deploy has not set.
 *
 * Inputs:
 * - None
 *
 * Outputs:
 * - string[] — the unset names, in `REQUIRED_VARS` order. Empty once the bucket is
 *   fully configured.
 */
export function missingS3Vars(): string[] {
	return REQUIRED_VARS.filter((name) => !env[name]);
}

/**
 * The client, built on first use and reused after. Memoized because a warm instance
 * serves many requests and each client sets up its own pool, but built lazily so the
 * environment is read at runtime, and keyed on the config so tests see their own values.
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
 * What to say when storage is asked for and no bucket is set up. A named message
 * rather than a bare throw, since this is what an organizer sees when uploads
 * mysteriously do not work.
 */
export const NO_STORAGE_MESSAGE =
	'No file storage configured. Set AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID and ' +
	'AWS_SECRET_ACCESS_KEY (see .env.example for the IAM policy the key needs).';

/**
 * Config for an operation that cannot proceed without it. `s3Configured` decides
 * whether to offer a feature; reaching one of these with no bucket is a bug in that
 * gate, so it throws rather than failing quietly.
 */
function requireConfig(): S3Config {
	const config = s3Config();
	if (!config) throw new Error(NO_STORAGE_MESSAGE);
	return config;
}

/**
 * The rejections that have exactly one cause in the environment, by the name the SDK
 * gives them.
 */
const FAILURE_CAUSES: Record<string, string> = {
	InvalidAccessKeyId: 'AWS_ACCESS_KEY_ID is not an access key this account knows',
	SignatureDoesNotMatch: 'AWS_SECRET_ACCESS_KEY does not match AWS_ACCESS_KEY_ID',
	NoSuchBucket: 'S3_BUCKET names a bucket that does not exist',
	PermanentRedirect: 'AWS_REGION is not the region S3_BUCKET is in',
	AccessDenied: 'the S3 key is not allowed this operation — check its IAM policy and S3_BUCKET',
	// Temporary credentials without their session token: the function is holding the
	// Lambda execution role's key, so this environment has no AWS_ACCESS_KEY_ID of its own.
	InvalidClientTokenId:
		'AWS_ACCESS_KEY_ID is unset on this environment, leaving the ' +
		"platform's own Lambda credentials in its place"
};

/**
 * Reads a rejection from S3 back as the thing that is wrong with the configuration.
 *
 * Inputs:
 * - error: unknown — whatever a `send` rejected with; an SDK error carries the `name`
 *   this matches on
 *
 * Outputs:
 * - string — the cause and the SDK's name for it, or `Name: message` when the name is
 *   not one with a single cause. Anything unrecognised passes through rather than
 *   being guessed at.
 *
 * Never throws: this runs on a path that is already failing, and is safe to log.
 */
export function describeS3Failure(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	return FAILURE_CAUSES[error.name]
		? `${FAILURE_CAUSES[error.name]} (${error.name})`
		: `${error.name}: ${error.message}`;
}

/**
 * Write an object, overwriting whatever was at that key. No delete-then-put:
 * `PutObject` already replaces atomically, and an unawaited delete can land after the
 * write it was meant to precede.
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
 * Remove an object. S3 treats deleting a missing key as success, so callers cleaning
 * up after a row that may never have had a file do not need to check first.
 */
export async function deleteObject(key: string): Promise<void> {
	const config = requireConfig();
	await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/**
 * A short-lived URL that downloads an object.
 *
 * `filename` sets `Content-Disposition`; without it the browser names the download
 * after the key, and our keys are ids, so a resume arrives as a bare cuid. The name is
 * quoted and stripped of quotes and newlines, being user-supplied data going into an
 * HTTP header. The bucket stays private, and this is the only way anything leaves it.
 *
 * `inline` renders in the browser instead of saving, for the PDF viewer. It also pins
 * the content type: what comes back is what the caller promised, not what the upload
 * carried.
 */
export async function signedDownloadUrl(
	key: string,
	options: { filename?: string; expiresIn?: number; inline?: boolean } = {}
): Promise<string> {
	const config = requireConfig();
	const command = new GetObjectCommand({
		Bucket: config.bucket,
		Key: key,
		...(options.filename && {
			ResponseContentDisposition: `${options.inline ? 'inline' : 'attachment'}; filename="${sanitiseFilename(options.filename)}"`
		}),
		...(options.inline && { ResponseContentType: 'application/pdf' })
	});

	return getSignedUrl(client(config), command, {
		expiresIn: options.expiresIn ?? DOWNLOAD_URL_TTL_SECONDS
	});
}

/**
 * Make a user-supplied name safe inside a quoted header parameter. Quotes would end
 * the parameter early and CR/LF the header itself, so both are dropped rather than
 * escaped. Path separators go too.
 */
function sanitiseFilename(name: string): string {
	const cleaned = name
		.replace(/["\\\r\n]/g, '')
		.replace(/[/]/g, '_')
		.trim();
	return cleaned || 'download';
}

/**
 * Complain at boot about a half-configured bucket. Deliberately not part of
 * `validateEnv()`: nothing set is an off switch, while three of four set is a typo
 * whose only symptom is a missing upload button.
 */
export function warnIncompleteS3Config(): void {
	for (const message of s3ConfigWarnings()) console.warn(`[s3] ${message}`);
}

/** The warnings `warnIncompleteS3Config` prints. Separated out to be testable. */
export function s3ConfigWarnings(): string[] {
	const missing = missingS3Vars();

	// All present, or all absent — both are coherent states.
	if (missing.length === 0 || missing.length === REQUIRED_VARS.length) return [];

	return [
		`File storage is partially configured and will stay disabled. Missing: ${missing.join(', ')}.`
	];
}
