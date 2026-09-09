/**
 * The rules behind custom-email attachments, kept out of the route handler and the
 * router — same split as `applicationFiles`, and for the same reason: handlers here
 * are untested, this module is covered.
 *
 * An attachment lives in the storage bucket under its own prefix, uploaded once at
 * compose time and read back per recipient at send time. The limits and the ref shape
 * are in `$lib/email/attachments`, shared with the compose page; this module holds
 * what only the server may decide — the keys it mints, and what it accepts back.
 * Everything that accepts a ref checks its key against `KEY_PATTERN`, so a request
 * cannot point a send at an arbitrary bucket object — an applicant's resume, say.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_EMAIL_ATTACHMENT_BYTES } from '$lib/email/attachments';
import type { UploadRejection } from './applicationFiles';

export { MAX_EMAIL_ATTACHMENTS } from '$lib/email/attachments';
export type { EmailAttachmentRef } from '$lib/email/attachments';

export const EMAIL_ATTACHMENT_KEY_PREFIX = 'email-attachments/';

/** Exactly the keys `emailAttachmentKey` mints: the prefix and a UUID, nothing else. */
const KEY_PATTERN = new RegExp(
	`^${EMAIL_ATTACHMENT_KEY_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
);

/** A fresh storage key for one uploaded attachment. */
export function emailAttachmentKey(): string {
	return `${EMAIL_ATTACHMENT_KEY_PREFIX}${randomUUID()}`;
}

/** What `startSend` accepts and EmailLog stores per attachment. */
export const attachmentRefSchema = z.object({
	key: z.string().regex(KEY_PATTERN, 'not an attachment key this server issued'),
	filename: z.string().trim().min(1).max(200),
	contentType: z.string().min(1).max(100),
	size: z.number().int().positive().max(MAX_EMAIL_ATTACHMENT_BYTES)
});

/**
 * Whether these bytes may be stored as an attachment. No extension allowlist, unlike
 * application uploads: the uploader is an admin choosing what to mail, not an
 * applicant who may have grabbed the wrong file.
 */
export function checkAttachmentUpload(file: {
	size: number;
	name: string;
}): UploadRejection | null {
	if (file.size === 0) {
		return { message: 'That file is empty.', status: 400 };
	}

	if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
		const limit = Math.floor(MAX_EMAIL_ATTACHMENT_BYTES / (1024 * 1024));
		return { message: `That file is over the ${limit} MB limit.`, status: 413 };
	}

	if (file.name.trim() === '') {
		return { message: 'That file has no name.', status: 400 };
	}

	return null;
}

/**
 * The refs an EmailLog row stores, read back defensively: the column is Json, so a row
 * that predates attachments (or holds the default `[]`) must come back as an empty
 * list rather than a crash mid-send.
 */
export function storedAttachmentRefs(value: unknown) {
	const parsed = z.array(attachmentRefSchema).safeParse(value);
	return parsed.success ? parsed.data : [];
}
