/**
 * Outbound email.
 *
 * Templates are authored as markdown at `/admin/email-templates` — organizers
 * write prose, not HTML — so every body is rendered to HTML on the way out.
 *
 * **Production is the only environment that sends.** Development and preview both
 * print the message and return.
 *
 * Preview used to send for real, fenced to `@yopmail.com` recipients. That fence
 * was one predicate standing between a branch deploy and four hundred applicants,
 * on deploys that run a production build against the production database — and it
 * only held as long as nobody widened it. Not sending at all is the same guarantee
 * without the predicate, so it is not a capability worth keeping.
 *
 * Failures throw. Callers that send in bulk wrap each recipient in
 * `Promise.allSettled` and record the rejection count in the audit trail, which
 * only works if a failure is actually distinguishable from a success.
 */

import { Resend } from 'resend';
import { marked } from 'marked';
import { env } from '$env/dynamic/private';
import { substituteVariables } from '$lib/email/variables';
import { deployEnv, emailFrom, resendConfigured, NO_EMAIL_MESSAGE } from './env';

export interface EmailPayload {
	to: string;
	subject: string;
	/** Markdown. Rendered to HTML before sending. */
	body: string;
}

/** Built once and reused, rather than per message. */
let resend: Resend | null = null;

function resendClient(): Resend {
	resend ??= new Resend(env.RESEND_API_KEY);
	return resend;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
	const where = deployEnv();
	// Everything that is not production prints and returns. Not an error, and not
	// conditional on configuration: a preview deploy with a key present must still
	// send nothing, so this is the environment check and nothing else.
	if (where !== 'production') {
		console.log(`[email] not sent — ${where} does not deliver mail`);
		console.log(`[email] To: ${payload.to}`);
		console.log(`[email] Subject: ${payload.subject}`);
		console.log(`[email] Body:\n${payload.body}`);
		return;
	}

	// Unreachable on a booted production deploy — `validateEnv` refuses to start
	// without a key — but a missing transport must never read as a delivered send.
	if (!resendConfigured()) throw new Error(NO_EMAIL_MESSAGE);

	const { error } = await resendClient().emails.send({
		to: payload.to,
		from: emailFrom(),
		subject: payload.subject,
		html: await marked.parse(payload.body)
	});

	// The SDK reports delivery failures in the response rather than by throwing, so
	// an unchecked call silently "succeeds" on a rejected send — and the bulk
	// callers would record that as delivered in the audit trail.
	if (error) throw new Error(`Resend rejected the message: ${error.message}`);
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
