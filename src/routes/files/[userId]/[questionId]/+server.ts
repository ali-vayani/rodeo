/**
 * Download for a FILE answer.
 *
 * Top-level rather than under /admin or /hacker because `hooks.server.ts` partitions
 * those two prefixes exactly, and this route serves both populations. Being outside
 * both guards means `canDownloadApplicationFile` is the only authorisation there is.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { QuestionType } from '$lib/generated/prisma/client';
import { prisma } from '$lib/server/db';
import { applicationFileKey, canDownloadApplicationFile } from '$lib/server/applicationFiles';
import {
	downloadResponse,
	storageFailureReason,
	storageUnavailableReason,
	withStorageDetail
} from '$lib/server/storage';

export const GET: RequestHandler = async ({ params, locals }) => {
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

	// A 302 to a presigned link, or the bytes — `$lib/server/storage` decides which.
	try {
		return await downloadResponse(key(params), response.value);
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
