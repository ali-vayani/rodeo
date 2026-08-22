/**
 * Uploads on the local filesystem, for development.
 *
 * Exists because the S3 path was otherwise unreachable without credentials: a developer
 * with no bucket got a file input that rendered, accepted a file, and answered 503.
 * Development only — the gate is in `storage.ts`.
 *
 * The layout mirrors the bucket exactly, the same keys as paths under `.uploads/`, so
 * switching backends is a configuration change and not a migration.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** Where uploads land. Gitignored. */
const ROOT = resolve(process.cwd(), '.uploads');

/**
 * A key resolved to a path inside `ROOT`, or a throw. Keys are derived from ids and
 * cannot contain traversal today, but this turns a string into a filesystem write.
 * `resolve` collapses `..` first, so the check is on the destination, not the spelling.
 */
function pathFor(key: string): string {
	const full = resolve(ROOT, key);
	if (full !== ROOT && !full.startsWith(ROOT + sep)) {
		throw new Error(`Refusing to resolve ${key} outside the uploads directory`);
	}
	return full;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
	const path = pathFor(key);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
}

export async function getObject(key: string): Promise<Buffer> {
	return readFile(pathFor(key));
}

/** Missing is success, matching S3's DeleteObject — callers need not check first. */
export async function deleteObject(key: string): Promise<void> {
	await rm(pathFor(key), { force: true });
}

/** Whether a key has bytes behind it. */
export async function exists(key: string): Promise<boolean> {
	try {
		await readFile(pathFor(key));
		return true;
	} catch {
		return false;
	}
}

/**
 * The bytes, as a download. `attachment` and a non-renderable type for the same reason
 * S3 gets `ResponseContentDisposition`: these are arbitrary bytes from an applicant and
 * this is our own origin.
 *
 * `inline` relaxes that for the PDF viewer, and the origin matters here in a way it does
 * not for S3: these bytes come from ours. Stating the type and forbidding sniffing is
 * what makes a `.pdf` that is really HTML a broken PDF and not a script running as us.
 */
export async function downloadResponse(
	key: string,
	filename: string,
	options: { inline?: boolean } = {}
): Promise<Response> {
	const body = await getObject(key);
	return new Response(new Uint8Array(body), {
		headers: {
			'Content-Type': options.inline ? 'application/pdf' : 'application/octet-stream',
			'Content-Disposition': `${options.inline ? 'inline' : 'attachment'}; filename="${sanitiseFilename(filename)}"`,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store'
		}
	});
}

/** Same rules as the S3 backend's: quotes end the parameter, CR/LF end the header. */
function sanitiseFilename(name: string): string {
	const cleaned = name
		.replace(/["\\\r\n]/g, '')
		.replace(/[/]/g, '_')
		.trim();
	return cleaned || 'download';
}

/** The directory uploads land in, for the startup notice in `storage.ts`. */
export const UPLOADS_ROOT = ROOT;

/** Exported for tests, which need a key→path answer without touching the disk. */
export { pathFor as localPathFor };
