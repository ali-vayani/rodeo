import { substituteVariables } from '$lib/email/variables';

export interface EmailPayload {
	to: string;
	subject: string;
	body: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
	if (process.env.NODE_ENV !== 'production') {
		console.log('[email] To:', payload.to);
		console.log('[email] Subject:', payload.subject);
		console.log('[email] Body:', payload.body);
		return;
	}
	// Production: wire up Resend or SMTP in Phase 15
	throw new Error('Production email sending not yet implemented');
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
		body: substituteVariables(template.body, vars)
	});
}
