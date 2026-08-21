/**
 * Upload for a FILE question.
 *
 * An endpoint rather than a tRPC procedure because a `File` cannot cross the client:
 * `$lib/trpc/client` is JSON over superjson, which has no binary type.
 *
 * Bytes are proxied through here rather than sent straight to the bucket with a
 * presigned PUT. That costs the 4.5 MB Vercel allows in a request body, and buys a
 * bucket with no public surface and no CORS rule.
 *
 * Kept thin — the decisions are in `$lib/server/applicationFiles`, where they are tested.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { QuestionType } from '$lib/generated/prisma/client';
import { prisma } from '$lib/server/db';
import { applicationWindowState } from '$lib/application/window';
import { applicationFileKey, checkUpload, uploadRefusal } from '$lib/server/applicationFiles';
import { putObject, storageConfigured } from '$lib/server/storage';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	// `hooks.server.ts` has established who this is and that they may reach
	// /hacker/*; it has not established anything about this question.
	const user = locals.user;
	if (!user) error(401, 'Sign in to upload a file.');

	if (!storageConfigured()) {
		error(503, 'File uploads are not available on this deployment.');
	}

	const [question, settings] = await Promise.all([
		prisma.question.findUnique({
			where: { id: params.questionId },
			select: { id: true, type: true, targetRole: true }
		}),
		prisma.settings.findFirst({
			select: { applicationOpen: true, applicationDeadline: true }
		})
	]);

	if (!question) error(404, 'That question does not exist.');
	if (question.type !== QuestionType.FILE) error(400, 'That question does not take a file.');

	// The same function the form renders from, so the two cannot drift.
	if (applicationWindowState(settings) !== 'open') {
		error(403, 'Applications are closed. Contact the organizers if you believe this is a mistake.');
	}

	const refusal = uploadRefusal(user, question);
	if (refusal) error(403, refusal);

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file was uploaded.');

	const rejection = checkUpload(file);
	if (rejection) error(rejection.status, rejection.message);

	// Bytes first: a row written before a failed upload would claim an answer the
	// bucket cannot serve, and the admissions pane would link to a 404.
	await putObject(
		applicationFileKey(user.uid, question.id),
		Buffer.from(await file.arrayBuffer()),
		file.type || 'application/octet-stream'
	);

	// The filename is the answer; the key is derived.
	await prisma.applicationResponse.upsert({
		where: { userId_questionId: { userId: user.uid, questionId: question.id } },
		update: { value: file.name },
		create: { userId: user.uid, questionId: question.id, value: file.name }
	});

	return json({ filename: file.name });
};
