/**
 * Upload validation and storage for custom-email and lifecycle-template attachments.
 * Draft uploads expire under the bucket policy. Saving a template copies its files
 * to a separate prefix so future lifecycle emails can still read them.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
	EMAIL_ATTACHMENT_KEY_PREFIX,
	TEMPLATE_ATTACHMENT_KEY_PREFIX,
	MAX_EMAIL_ATTACHMENT_BYTES,
	type EmailAttachmentRef
} from '$lib/email/attachments';
import type { UploadRejection } from './applicationFiles';
import type { EmailAttachment } from './email';
import { getObject, putObject, deleteObject } from './storage';

export { MAX_EMAIL_ATTACHMENTS } from '$lib/email/attachments';
export type { EmailAttachmentRef } from '$lib/email/attachments';

export { EMAIL_ATTACHMENT_KEY_PREFIX } from '$lib/email/attachments';

/** Only upload and saved-template prefixes may be attached or previewed. */
const KEY_PATTERN = new RegExp(
	`^(?:${EMAIL_ATTACHMENT_KEY_PREFIX}|${TEMPLATE_ATTACHMENT_KEY_PREFIX})[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
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

	if (file.name.trim() === '' || file.name.trim().length > 200) {
		return { message: 'Use a filename between 1 and 200 characters.', status: 400 };
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

export async function loadEmailAttachments(refs: EmailAttachmentRef[]): Promise<EmailAttachment[]> {
	return Promise.all(
		refs.map(async (ref) => ({
			filename: ref.filename,
			content: await getObject(ref.key),
			contentType: ref.contentType
		}))
	);
}

/** Saved templates must outlive the lifecycle policy for draft uploads. */
export async function persistTemplateAttachments(refs: EmailAttachmentRef[], created: string[]) {
	const saved: EmailAttachmentRef[] = [];
	for (const ref of refs) {
		const bytes = await getObject(ref.key);
		if (bytes.length !== ref.size) throw new Error(`The file size changed for ${ref.filename}.`);
		if (ref.key.startsWith(TEMPLATE_ATTACHMENT_KEY_PREFIX)) {
			saved.push(ref);
			continue;
		}
		const key = `${TEMPLATE_ATTACHMENT_KEY_PREFIX}${randomUUID()}`;
		created.push(key);
		await putObject(key, bytes, ref.contentType);
		saved.push({ ...ref, key });
	}
	return saved;
}

export async function removeEmailAttachments(keys: string[]) {
	await Promise.all(
		keys.map(async (key) => {
			try {
				await deleteObject(key);
			} catch (error) {
				console.error(`[email] Could not remove attachment ${key}:`, error);
			}
		})
	);
}
