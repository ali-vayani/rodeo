/**
 * Outbound email. Templates are authored as markdown, so every body is rendered to
 * HTML on the way out.
 *
 * Production is the only environment that sends; development and preview print the
 * message and return. Preview used to send for real, fenced to `@yopmail.com`, which
 * was one predicate standing between a branch deploy and four hundred applicants.
 *
 * Failures throw. Bulk callers wrap each recipient in `Promise.allSettled` and record
 * the rejection count, which only works if a failure is distinguishable from a success.
 */

import { Resend } from 'resend';
import { marked } from 'marked';
import { env } from '$env/dynamic/private';
import { substituteVariables } from '$lib/email/variables';
import { deployEnv, emailFrom, resendConfigured, NO_EMAIL_MESSAGE } from './env';

/**
 * A file carried inside the message. Exists for inline images: the check-in QR
 * referenced as `cid:<contentId>` rather than hosted where a proxy could cache it.
 * Transport-neutral; `sendEmail` translates it to Resend's spelling.
 */
export interface EmailAttachment {
	filename: string;
	content: Buffer;
	contentType: string;
	/** The `cid:` the body references. */
	contentId: string;
	/** `inline` renders in place; otherwise the client offers it as a download. */
	inline: boolean;
}

export interface EmailPayload {
	to: string;
	subject: string;
	/** Markdown. Rendered to HTML before sending. */
	body: string;
	attachments?: EmailAttachment[];
}

let resend: Resend | null = null;

function resendClient(): Resend {
	resend ??= new Resend(env.RESEND_API_KEY);
	return resend;
}

/**
 * Sends one message, or logs it outside production.
 *
 * Inputs:
 * - payload: EmailPayload — recipient, subject, markdown body, optional attachments
 *
 * Outputs:
 * - void
 *
 * Throws:
 * - Error — in production, when no transport is configured or Resend rejects the send
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
	const where = deployEnv();
	// Everything that is not production prints and returns. Not conditional on
	// configuration: a preview deploy with a key present must still send nothing.
	if (where !== 'production') {
		console.log(`[email] not sent — ${where} does not deliver mail`);
		console.log(`[email] To: ${payload.to}`);
		console.log(`[email] Subject: ${payload.subject}`);
		console.log(`[email] Body:\n${payload.body}`);
		for (const a of payload.attachments ?? []) {
			console.log(
				`[email] Attachment: ${a.filename} (${a.contentType}, ${a.content.length} bytes, cid:${a.contentId})`
			);
		}
		return;
	}

	// Unreachable on a booted production deploy — `validateEnv` refuses to start
	// without a key — but a missing transport must never read as a delivered send.
	if (!resendConfigured()) throw new Error(NO_EMAIL_MESSAGE);

	const attachments = payload.attachments ?? [];

	const { error } = await resendClient().emails.send({
		to: payload.to,
		from: emailFrom(),
		subject: payload.subject,
		html: await marked.parse(payload.body),
		// Resend names the header `content_id` and infers inline placement from
		// the body referencing it, so there is no `inline` flag to pass here.
		...(attachments.length
			? {
					attachments: attachments.map((a) => ({
						filename: a.filename,
						content: a.content,
						contentType: a.contentType,
						content_id: a.contentId
					}))
				}
			: {})
	});

	// The SDK reports delivery failures in the response rather than by throwing, so an
	// unchecked call silently "succeeds" on a rejected send.
	if (error) throw new Error(`Resend rejected the message: ${error.message}`);
}

/** Substitutes `vars` into both halves of a stored template and sends it. */
export async function sendTemplatedEmail(
	to: string,
	template: { subject: string; body: string },
	vars: Record<string, string>,
	attachments: EmailAttachment[] = []
): Promise<void> {
	await sendEmail({
		to,
		// `dropRawValues` because a subject is plain text and the editor's chips can insert
		// into it. `{{hacker_qr_code}}` up here would mail a subject of raw `<table>` markup.
		subject: substituteVariables(template.subject, vars, { dropRawValues: true }),
		// Body becomes HTML via `marked` — escape user-controlled variable values.
		body: substituteVariables(template.body, vars, { escapeValues: true }),
		attachments
	});
}
