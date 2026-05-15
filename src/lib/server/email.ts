export interface EmailPayload {
	to: string;
	subject: string;
	body: string;
}

function substituteVariables(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
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

export async function sendTemplatedEmail(
	to: string,
	template: string,
	vars: Record<string, string>
): Promise<void> {
	const subject = vars['subject'] ?? 'Notification from Rodeo';
	const body = substituteVariables(template, vars);
	await sendEmail({ to, subject, body });
}
