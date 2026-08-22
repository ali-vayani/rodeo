/**
 * Download for a FILE answer, and — with `?inline` — the source the PDF viewer frames.
 *
 * Top-level rather than under /admin or /hacker because `hooks.server.ts` partitions
 * those two prefixes exactly, and this route serves both populations. Being outside
 * both guards means `canDownloadApplicationFile` is the only authorisation there is.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { QuestionType } from '$lib/generated/prisma/client';
import { prisma } from '$lib/server/db';
import { isPdfFilename } from '$lib/application/files';
import { applicationFileKey, canDownloadApplicationFile } from '$lib/server/applicationFiles';
import {
	downloadResponse,
	storageFailureReason,
	storageUnavailableReason,
	withStorageDetail
} from '$lib/server/storage';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const viewer = locals.user;
	if (!viewer) error(401, 'Sign in to download this file.');

	if (!canDownloadApplicationFile(viewer, params.userId)) {
		// The same 403 whether the answer exists or not — distinguishing them would
		// answer "did this person upload anything" for a stranger.
		error(403, 'You do not have access to this file.');
	}

	const unavailable = storageUnavailableReason();
	if (unavailable) {
		console.error(`[storage] Download refused for ${key(params)}: ${unavailable}.`);
		error(503, withStorageDetail('File storage is not available on this deployment.', unavailable));
	}

	// The row is what says a file was uploaded, and carries the name to serve it under.
	const response = await prisma.applicationResponse.findUnique({
		where: { userId_questionId: { userId: params.userId, questionId: params.questionId } },
		select: { value: true, question: { select: { type: true } } }
	});

	if (!response || response.question.type !== QuestionType.FILE || response.value.trim() === '') {
		error(404, 'No file has been uploaded for this question.');
	}

	// Rendering arbitrary uploads in place is how a `.html` "resume" becomes a script on
	// our own origin.
	const inline = url.searchParams.has('inline');
	if (inline && !isPdfFilename(response.value)) {
		error(400, 'Only PDF files can be viewed in the browser.');
	}

	// A 302 to a presigned link, or the bytes — `$lib/server/storage` decides which.
	try {
		const file = await downloadResponse(key(params), response.value, { inline });
		// `hooks.server.ts` denies framing to anything that does not say otherwise, and the
		// viewer frames this.
		if (inline) file.headers.set('X-Frame-Options', 'SAMEORIGIN');
		return file;
	} catch (e) {
		// The row says there is a file and the backend disagrees: wrong credentials, wrong
		// region, or an object that is gone.
		const reason = storageFailureReason(e);
		console.error(`[storage] Download failed for ${key(params)}: ${reason}`);
		error(502, withStorageDetail('That file could not be downloaded.', reason));
	}
};

function key(params: { userId: string; questionId: string }): string {
	return applicationFileKey(params.userId, params.questionId);
}
