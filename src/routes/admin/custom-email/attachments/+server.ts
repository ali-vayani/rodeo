/**
 * Upload and removal for custom-email attachments.
 *
 * An endpoint rather than a tRPC procedure for the same reason as application files:
 * a `File` cannot cross `$lib/trpc/client`, which is JSON over superjson. Bytes are
 * proxied through here rather than presigned, keeping the bucket without a public
 * surface — and capping each file at the 4.5 MB Vercel allows a request body.
 *
 * The ref this returns is what `email.startSend` accepts; only keys minted here pass
 * its schema, so an upload is the sole way anything enters a send.
 *
 * Kept thin — the decisions are in `$lib/server/emailAttachments`, where they are tested.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/auth/permissions';
import {
	attachmentRefSchema,
	checkAttachmentUpload,
	emailAttachmentKey
} from '$lib/server/emailAttachments';
import {
	deleteObject,
	downloadResponse,
	putObject,
	storageFailureReason,
	storageUnavailableReason,
	withStorageDetail
} from '$lib/server/storage';

/** `hooks.server.ts` already walls off /admin/custom-email/*, but it answers with a
 * redirect; an endpoint should refuse in its own voice. */
function requireAdmin(locals: App.Locals) {
	if (!locals.user || !isAdmin(locals.user.role)) {
		error(403, 'Only admins can manage email attachments.');
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	const unavailable = storageUnavailableReason();
	if (unavailable) {
		console.error(`[storage] Email attachment upload refused: ${unavailable}.`);
		error(
			503,
			withStorageDetail('File attachments are not available on this deployment.', unavailable)
		);
	}

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file was uploaded.');

	const rejection = checkAttachmentUpload(file);
	if (rejection) error(rejection.status, rejection.message);

	const key = emailAttachmentKey();
	const contentType = file.type || 'application/octet-stream';
	try {
		await putObject(key, Buffer.from(await file.arrayBuffer()), contentType);
	} catch (e) {
		const reason = storageFailureReason(e);
		console.error(`[storage] Email attachment upload failed for ${key}: ${reason}`);
		error(502, withStorageDetail('The file could not be stored. Try again.', reason));
	}

	return json({ key, filename: file.name, contentType, size: file.size });
};

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals);
	const parsed = attachmentRefSchema
		.pick({ key: true, filename: true, contentType: true })
		.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) error(400, 'Not a valid attachment.');
	const { key, filename, contentType } = parsed.data;
	try {
		return await downloadResponse(key, filename, { inline: contentType === 'application/pdf' });
	} catch (e) {
		console.error(`[storage] Email attachment preview failed: ${storageFailureReason(e)}`);
		error(404, 'This attachment is unavailable. Remove and re-attach it.');
	}
};

/** Removes an attachment the admin discarded before sending. Best effort — an orphan
 * in the bucket costs nothing, so a failure here is a log line, not a broken draft. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	const parsed = attachmentRefSchema.shape.key.safeParse((await request.json())?.key);
	if (!parsed.success) error(400, 'Not an attachment key.');

	try {
		await deleteObject(parsed.data);
	} catch (e) {
		console.error(`[storage] Email attachment delete failed: ${storageFailureReason(e)}`);
	}
	return json({ ok: true });
};
