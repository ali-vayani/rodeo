/**
 * Outbound email.
 *
 * Templates are authored as markdown at `/admin/email-templates` — organizers
 * write prose, not HTML — so every body is rendered to HTML on the way out.
 *
 * Three environments, three behaviours:
 *
 *   - **development** — nothing leaves the machine; the message is printed.
 *   - **preview** — real transport, but only `@yopmail.com` addresses are
 *     accepted. A preview deploy runs a production build against the production
 *     database, and the one mistake that cannot be taken back is mailing four
 *     hundred applicants from a branch.
 *   - **production** — Resend if configured, SMTP otherwise.
 *
 * Anything outside production also carries a banner saying so, so a test message
 * that does reach a human inbox can't be mistaken for the real thing.
 *
 * Failures throw. Callers that send in bulk wrap each recipient in
 * `Promise.allSettled` and record the rejection count in the audit trail, which
 * only works if a failure is actually distinguishable from a success.
 */

import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import { marked } from 'marked';
import { env } from '$env/dynamic/private';
import { substituteVariables } from '$lib/email/variables';
import { deployEnv, emailFrom, emailTransport } from './env';

export interface EmailPayload {
	to: string;
	subject: string;
	/** Markdown. Rendered to HTML before sending. */
	body: string;
}

const PREVIEW_ALLOWED_DOMAIN = '@yopmail.com';

const WARNING_BANNER =
	'<p style="background:#fff4e5;border:1px solid #ffb020;padding:12px;' +
	'border-radius:6px;font-family:sans-serif;font-size:14px;">' +
	'<strong>This email came from a Rodeo test environment.</strong> ' +
	'Do not trust its links or attachments — it is not guaranteed to be from Freetail Hackers.' +
	'</p>';

/**
 * Built once and reused. Nodemailer pools connections per transporter, so
 * constructing one per message would open a fresh SMTP handshake per recipient.
 */
let transporter: Transporter | null = null;

function smtpTransporter(): Transporter {
	transporter ??= nodemailer.createTransport({
		host: env.EMAIL_HOST,
		port: Number(env.EMAIL_PORT ?? 465),
		// Port 587 is STARTTLS, which begins in the clear and upgrades; 465 is TLS
		// from the first byte. Deriving this from the port is what the field means.
		secure: Number(env.EMAIL_PORT ?? 465) === 465,
		auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS }
	});
	return transporter;
}

let resend: Resend | null = null;

function resendClient(): Resend {
	resend ??= new Resend(env.RESEND_API_KEY);
	return resend;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
	const where = deployEnv();
	const html = await marked.parse(payload.body);

	if (where === 'development') {
		console.log(`[email] To: ${payload.to}`);
		console.log(`[email] Subject: ${payload.subject}`);
		console.log(`[email] Body:\n${payload.body}`);
		return;
	}

	if (where === 'preview' && !payload.to.toLowerCase().endsWith(PREVIEW_ALLOWED_DOMAIN)) {
		// Not an error: a preview send to a real address is expected while testing
		// against production data, and throwing would make every such batch look
		// like a failure in the audit trail.
		console.log(`[email] skipped ${payload.to} — preview only sends to ${PREVIEW_ALLOWED_DOMAIN}`);
		return;
	}

	const message = {
		to: payload.to,
		from: emailFrom(),
		subject: payload.subject,
		html: where === 'production' ? html : WARNING_BANNER + html
	};

	switch (emailTransport()) {
		case 'resend': {
			const { error } = await resendClient().emails.send(message);
			// The SDK reports delivery failures in the response rather than by
			// throwing, so an unchecked call silently "succeeds" on a rejected send.
			if (error) throw new Error(`Resend rejected the message: ${error.message}`);
			return;
		}
		case 'smtp':
			await smtpTransporter().sendMail(message);
			return;
		default:
			throw new Error(
				'No email transport configured. Set RESEND_API_KEY, or all of ' +
					'EMAIL_HOST / EMAIL_USER / EMAIL_PASS for SMTP.'
			);
	}
}

/** Substitutes `vars` into both halves of a stored template and sends it. */
export async function sendTemplatedEmail(
	to: string,
	template: { subject: string; body: string },
	vars: Record<string, string>
): Promise<void> {
	await sendEmail({
		to,
		subject: substituteVariables(template.subject, vars),
		// Body becomes HTML via `marked` — escape user-controlled variable values.
		body: substituteVariables(template.body, vars, { escapeValues: true })
	});
}
