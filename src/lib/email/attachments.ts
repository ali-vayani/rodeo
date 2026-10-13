/**
 * Custom-email attachment limits and the ref shape, shared between the compose page
 * and the server. Isomorphic on purpose — the page checks before uploading, the
 * server checks again — and one copy of each number, because the picker's limit and
 * the endpoint's refusal must be the same fact.
 */

export const MAX_EMAIL_ATTACHMENTS = 5;
export const EMAIL_ATTACHMENT_KEY_PREFIX = 'email-attachments/';
export const TEMPLATE_ATTACHMENT_KEY_PREFIX = 'email-template-attachments/';
export const EMAIL_ATTACHMENT_RETENTION_DAYS = 30;

/**
 * Per-file ceiling. Vercel caps a function's request body at 4.5 MB and the upload
 * proxies bytes through one — the same bound as `MAX_UPLOAD_BYTES` in `server/s3.ts`,
 * restated here because that module cannot be imported by the browser. Five files at
 * this cap is ~27 MB once base64 inflates it, under Resend's 40 MB message limit.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/**
 * What the upload endpoint returns and `email.startSend` accepts. The key is an opaque
 * server-minted storage key; filename and content type ride along because nothing else
 * remembers what the file was called.
 */
export type EmailAttachmentRef = {
	key: string;
	filename: string;
	contentType: string;
	size: number;
};

export function attachmentPreviewUrl(
	ref: EmailAttachmentRef
): `/admin/custom-email/attachments?${string}` {
	return `/admin/custom-email/attachments?${new URLSearchParams({
		key: ref.key,
		filename: ref.filename,
		contentType: ref.contentType
	})}`;
}
