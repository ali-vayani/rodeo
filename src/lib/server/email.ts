/**
 * Outbound email. Templates are authored as markdown, so every body is rendered to
 * HTML on the way out.
 *
 * Production is the only environment that sends; development and preview print the
 * message and return. Preview used to send for real, fenced to `@yopmail.com`, which
 * was one predicate standing between a branch deploy and four hundred applicants.
 *
 * Failures throw, so that a rejected send is never mistaken for a delivered one. Bulk
 * callers catch per recipient and record the outcome: `email.sendOne` returns it to the
 * page driving the send, and the decision release counts rejections from
 * `Promise.allSettled`.
 *
 * Nothing here paces itself. Resend allows a team 10 requests/second and answers a burst
 * past that with a 429, so anything mailing a list has to space its own calls.
 */

import { Resend } from 'resend';
import { marked } from 'marked';
import { env } from '$env/dynamic/private';
import { substituteVariables } from '$lib/email/variables';
import { deployEnv, emailFrom, resendConfigured, NO_EMAIL_MESSAGE } from './env';

/**
 * A file carried inside the message. Two kinds share the shape: inline images — the
 * check-in QR referenced as `cid:<contentId>` rather than hosted where a proxy could
 * cache it — and plain attachments the client offers as a download, which have no cid.
 * Transport-neutral; `sendEmail` translates it to Resend's spelling.
 */
export interface EmailAttachment {
	filename: string;
	content: Buffer;
	contentType: string;
	/** The `cid:` the body references. Absent on a plain (download) attachment. */
	contentId?: string;
	/** `inline` renders in place; otherwise the client offers it as a download. */
	inline?: boolean;
}

export interface EmailPayload {
	to: string;
	subject: string;
	/** Markdown. Rendered to HTML before sending. */
	body: string;
	attachments?: EmailAttachment[];
	idempotencyKey?: string;
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
				`[email] Attachment: ${a.filename} (${a.contentType}, ${a.content.length} bytes` +
					`${a.contentId ? `, cid:${a.contentId}` : ''})`
			);
		}
		return;
	}

	// Unreachable on a booted production deploy — `validateEnv` refuses to start
	// without a key — but a missing transport must never read as a delivered send.
	if (!resendConfigured()) throw new Error(NO_EMAIL_MESSAGE);

	const attachments = payload.attachments ?? [];

	const { error } = await resendClient().emails.send(
		{
			to: payload.to,
			from: emailFrom(),
			subject: payload.subject,
			html: await marked.parse(payload.body),
			// The SDK maps contentId to content_id. Send base64 explicitly because a
			// Buffer becomes a JSON object when the SDK serializes the request.
			...(attachments.length
				? {
						attachments: attachments.map((a) => ({
							filename: a.filename,
							content: a.content.toString('base64'),
							contentType: a.contentType,
							// Only inline images carry one; a cid on a plain attachment would
							// hide it from clients that treat cid parts as inline-only.
							...(a.contentId ? { contentId: a.contentId } : {})
						}))
					}
				: {})
		},
		payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : undefined
	);

	// The SDK reports delivery failures in the response rather than by throwing, so an
	// unchecked call silently "succeeds" on a rejected send.
	if (error) throw new Error(`Resend rejected the message (${error.name}): ${error.message}`);
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
