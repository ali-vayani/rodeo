/**
 * Where uploaded files go, and the only storage interface the app calls.
 *
 * Two backends behind one call, as `wallet/model.ts` picks between bundled and remote
 * pass artwork: `./s3` for anything deployed, `./storage-local` for development.
 * Which one is decided by whether a bucket is configured, with no variable of its own —
 * set the four `./s3` requires and you get the bucket, don't and you get the disk.
 *
 * The local backend never runs on a deploy. Serverless filesystems are per-instance and
 * ephemeral, so a deploy that lost its bucket must refuse uploads rather than quietly
 * write them somewhere they will disappear from — hence the gate on the environment
 * rather than merely on what is configured.
 */

import { deployEnv } from './env';
import * as local from './storage-local';
import {
	describeS3Failure,
	deleteObject as s3Delete,
	getObject as s3Get,
	putObject as s3Put,
	missingS3Vars,
	s3Configured,
	signedDownloadUrl
} from './s3';

export type StorageBackend = 's3' | 'local' | 'none';

/** Which backend is in play. Read per call, because the environment is populated at runtime. */
export function storageBackend(): StorageBackend {
	if (s3Configured()) return 's3';
	return deployEnv() === 'development' ? 'local' : 'none';
}

/** Whether uploads can be offered at all. Callers gate the UI and the endpoint on this. */
export function storageConfigured(): boolean {
	return storageBackend() !== 'none';
}

/**
 * Says why uploads are off, naming the variables that are unset.
 *
 * Inputs:
 * - None
 *
 * Outputs:
 * - string | null — e.g. `'S3_BUCKET, AWS_REGION not set'`, or null when uploads work.
 *   For a log line or a non-production response — see `withStorageDetail`.
 */
export function storageUnavailableReason(): string | null {
	// Reaching here means the four are not all set: that is the only way past
	// `storageBackend`, since development falls back to the disk.
	return storageConfigured() ? null : `${missingS3Vars().join(', ')} not set`;
}

/**
 * Says what a failed read or write means for the configuration.
 *
 * Inputs:
 * - error: unknown — whatever the backend rejected with
 *
 * Outputs:
 * - string — S3's reading of it when a bucket is in play, the raw message on disk.
 */
export function storageFailureReason(error: unknown): string {
	if (storageBackend() === 's3') return describeS3Failure(error);
	return error instanceof Error ? error.message : String(error);
}

/**
 * Attaches the server-side reason to a message the client will see, outside production.
 *
 * On preview and in development whoever reads the response is the person who can fix the
 * deploy. In production it is an applicant, who can do nothing with a variable name and
 * should not be shown one — there the reason goes to the log and nowhere else.
 *
 * Inputs:
 * - message: string — what the client is told
 * - reason: string — server-side detail, from `storageUnavailableReason` or
 *   `storageFailureReason`
 *
 * Outputs:
 * - string — `message` in production, `message (reason)` everywhere else
 */
export function withStorageDetail(message: string, reason: string): string {
	return deployEnv() === 'production' ? message : `${message} (${reason})`;
}

export const NO_STORAGE_MESSAGE =
	'File storage is not configured on this deployment. Set AWS_REGION, S3_BUCKET, ' +
	'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (see .env.example).';

function backendOrThrow(): 's3' | 'local' {
	const backend = storageBackend();
	if (backend === 'none') throw new Error(NO_STORAGE_MESSAGE);
	return backend;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	if (backendOrThrow() === 's3') return s3Put(key, body, contentType);
	// Local stores bytes only; nothing reads the content type back, since downloads are
	// served as attachments either way.
	return local.putObject(key, body);
}

export async function getObject(key: string): Promise<Buffer> {
	return backendOrThrow() === 's3' ? s3Get(key) : local.getObject(key);
}

export async function deleteObject(key: string): Promise<void> {
	return backendOrThrow() === 's3' ? s3Delete(key) : local.deleteObject(key);
}

/**
 * A response that downloads the object. A `Response` rather than a URL because only one
 * backend has a URL to give: S3 redirects to a presigned link so the bytes never pass
 * through a function, while local has nothing to presign and serves the file itself.
 */
export async function downloadResponse(key: string, filename: string): Promise<Response> {
	if (backendOrThrow() === 's3') {
		return new Response(null, {
			status: 302,
			headers: {
				location: await signedDownloadUrl(key, { filename }),
				// That URL is a bearer credential for the next minute.
				'Cache-Control': 'private, no-store'
			}
		});
	}

	return local.downloadResponse(key, filename);
}

/**
 * Say at boot which backend is in play, when it isn't a bucket. A developer who set
 * three of the four variables would otherwise see uploads apparently working and never
 * learn they went to disk.
 */
export function reportStorageBackend(): void {
	const backend = storageBackend();

	if (backend === 'local') {
		console.info(`[storage] Uploads are being written to ${local.UPLOADS_ROOT} (development).`);
	}

	if (backend === 'none' && deployEnv() !== 'development') {
		// Named rather than generic, because three of the four set is a typo. Not a throw:
		// a deploy with no FILE questions works fine without a bucket, so a missing one
		// must not be able to take the site down.
		console.error(
			`[storage] ${storageUnavailableReason()}. ${NO_STORAGE_MESSAGE} ` +
				'File questions will refuse uploads.'
		);
	}
}
