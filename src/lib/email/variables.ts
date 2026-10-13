/**
 * Template variable definitions and substitution.
 *
 * Isomorphic: imported by the admin editor (browser) and the routers that send mail
 * (server), so keep it free of Prisma, node builtins and `$env`.
 */

/**
 * The single source of truth for which `{{variables}}` exist.
 *
 * A variable listed here MUST be produced by `buildTemplateVars`, or the editor
 * advertises a placeholder that arrives unsubstituted in a hacker's inbox.
 * `variables.test.ts` asserts the two stay in sync.
 *
 * `placeholder` names the value rather than imitating one, so an organizer proofreading
 * a draft can tell a working template from one about to mail the wrong date.
 */
export const TEMPLATE_VARIABLES = [
	{ key: 'name', label: "Hacker's full name", placeholder: '[hacker name]' },
	{ key: 'hackathon_start', label: 'Hackathon start date', placeholder: '[start date]' },
	// Not "[end date]": this is the RSVP cutoff, not when the event ends. Labelling it
	// as an end date would be the same lie in a shorter form.
	{ key: 'rsvp_deadline', label: 'RSVP deadline', placeholder: '[RSVP deadline]' },
	{
		key: 'walkin_link',
		label: 'Walk-in page link',
		placeholder: '[walk-in link]',
		hint:
			'A link to the walk-in page in the hacker portal. It carries no credential — ' +
			'the recipient signs in with the invited email address to use it.'
	},
	{
		key: 'hacker_qr_code',
		label: 'Hacker QR code',
		placeholder: '[QR code + wallet buttons]',
		hint:
			"Inserts the recipient's QR code, their RC- code, and Add to Apple/Google " +
			'Wallet buttons. Confirmed attendees only; the wallet buttons appear once ' +
			'the RSVP deadline has passed.',
		/**
		 * Substitutes pre-built HTML rather than text, so it must not be escaped into the
		 * body. Everything inside comes from `$lib/server/wallet/email-block`, which
		 * escapes the one user-controlled value. Nothing else may be `raw` without that.
		 */
		raw: true
	}
] as const;

export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];

export const VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.key);

/**
 * Variables whose value is markup. They skip HTML escaping in a body and are dropped
 * from a subject, which is plain text.
 */
export const RAW_VARIABLE_KEYS: ReadonlySet<string> = new Set(
	TEMPLATE_VARIABLES.filter((v) => 'raw' in v && v.raw).map((v) => v.key)
);

/**
 * Placeholder values for the lifecycle template editor, which previews a template
 * rather than a message. The compose preview has a real recipient and uses that.
 */
export const SAMPLE_VARS: Record<string, string> = Object.fromEntries(
	TEMPLATE_VARIABLES.map((v) => [v.key, v.placeholder])
);

/**
 * What `{{name}}` becomes when there is no name to substitute: an external address
 * with no User row, or a row whose linked name question is still unanswered, which
 * would render "Hi ,". Exported because the compose preview substitutes the same value.
 */
export const NAME_FALLBACK = 'hacker';

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/** Escape the five HTML-significant characters. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Replace `{{key}}` with `vars[key]`. Unknown keys are left literal.
 *
 * `escapeValues` is used for the body, which is rendered through `marked`. Values
 * include `name`, which an applicant controls, so without it a name like `<script>...`
 * would inject live markup. Subjects and the admin preview pass false.
 */
export function substituteVariables(
	template: string,
	vars: Record<string, string>,
	{
		escapeValues = false,
		dropRawValues = false
	}: { escapeValues?: boolean; dropRawValues?: boolean } = {}
): string {
	return template.replace(VARIABLE_PATTERN, (_, key) => {
		const value = vars[key];
		if (value === undefined) return `{{${key}}}`;

		if (RAW_VARIABLE_KEYS.has(key)) {
			// A markup block. Dropped from subjects, and never escaped in a body —
			// escaping it would mail the hacker the HTML source of their own QR code.
			return dropRawValues ? '' : value;
		}
		return escapeValues ? escapeHtml(value) : value;
	});
}

/**
 * Variables with nothing to substitute under these settings, mapped to why not.
 *
 * Only event-level variables can appear here, and only `rsvp_deadline` can today: its
 * column is nullable, and an event that never closes RSVPs has no date to name.
 *
 * `hacker_qr_code` is deliberately absent. It is empty for a recipient who is not
 * attending, which is a fact about that recipient rather than the event — blocking on it
 * would stop every non-attendee's mail, which is the opposite of what it is for.
 */
export function unavailableVariables(settings: {
	RSVPDeadline: Date | string | null;
}): Map<string, string> {
	const unavailable = new Map<string, string>();
	if (settings.RSVPDeadline == null) {
		unavailable.set('rsvp_deadline', 'no RSVP Deadline is set');
	}
	return unavailable;
}

/**
 * Why these texts cannot be mailed as they stand, or null when they can.
 *
 * The rule every send path shares: a template may only go out if every variable it
 * names has a value. Substituting nothing would mail a sentence with a hole in it, and
 * substituting a stand-in would mail a date the event does not have.
 *
 * Pass the subject and the body — a variable in either one is enough to stop the send.
 */
export function templateBlockers(
	texts: readonly string[],
	settings: { RSVPDeadline: Date | string | null }
): { keys: string[]; message: string } | null {
	const unavailable = unavailableVariables(settings);
	if (unavailable.size === 0) return null;

	const keys: string[] = [];
	for (const text of texts) {
		// Fresh lastIndex per text: VARIABLE_PATTERN is global and module-scoped.
		VARIABLE_PATTERN.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
			const key = match[1];
			if (unavailable.has(key) && !keys.includes(key)) keys.push(key);
		}
	}
	if (keys.length === 0) return null;

	const named = keys.map((key) => `{{${key}}}`).join(' and ');
	const reasons = [...new Set(keys.map((key) => unavailable.get(key)!))].join(' and ');
	return {
		keys,
		message:
			`This email uses ${named}, but ${reasons}. ` +
			'Remove the variable from the template, or set the date under Settings → Dates.'
	};
}

export type TemplateSegment =
	| { type: 'text'; value: string }
	/** `value` is the substituted sample; the source text was `{{key}}`. */
	| { type: 'known'; value: string; key: string }
	/** No value to substitute, so `value` is the literal `{{key}}`. */
	| { type: 'unknown'; value: string; key: string };

/**
 * Split a template into renderable segments so the preview can mark up variables
 * without `{@html}` — Svelte escapes each segment's text for us.
 */
export function tokenizeTemplate(
	template: string,
	vars: Record<string, string> = SAMPLE_VARS
): TemplateSegment[] {
	const segments: TemplateSegment[] = [];
	let last = 0;

	// Fresh lastIndex per call: VARIABLE_PATTERN is global and module-scoped.
	VARIABLE_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = VARIABLE_PATTERN.exec(template)) !== null) {
		if (match.index > last) {
			segments.push({ type: 'text', value: template.slice(last, match.index) });
		}
		const key = match[1];
		const value = vars[key];
		segments.push(
			value === undefined
				? { type: 'unknown', value: `{{${key}}}`, key }
				: { type: 'known', value, key }
		);
		last = match.index + match[0].length;
	}

	if (last < template.length) {
		segments.push({ type: 'text', value: template.slice(last) });
	}

	return segments;
}

/**
 * The half of the substitution map that does not depend on the recipient.
 *
 * Rendered on the server so the compose preview shows the exact strings a send will.
 * Formatting in the browser would use the viewer's locale and timezone.
 */
export function buildEventVars(
	settings: {
		hackathonStartDate: Date;
		RSVPDeadline: Date | null;
	},
	/**
	 * The absolute /hacker/walkin URL. Passed in because this module is isomorphic and
	 * `appOrigin()` is server-only; server callers build it with `walkInUrl()` from
	 * `$lib/server/walkin`. Defaults to empty, which only tests exercise.
	 */
	walkInLink = ''
): Record<string, string> {
	// Blank, not the event start: an event with no deadline has no date to name, and
	// putting the start date under an "RSVP deadline" label states something untrue.
	// A template that uses the variable is refused by `templateBlockers` before it can
	// send, so this value is the floor rather than the plan.
	return {
		hackathon_start: settings.hackathonStartDate.toLocaleDateString(),
		rsvp_deadline: settings.RSVPDeadline ? settings.RSVPDeadline.toLocaleDateString() : '',
		walkin_link: walkInLink
	};
}

/**
 * Build the substitution map for a real send. Structurally typed so callers can pass a
 * Prisma `User`/`Settings` row without this module importing Prisma.
 */
export function buildTemplateVars(
	user: { name: string },
	settings: { hackathonStartDate: Date; RSVPDeadline: Date | null },
	/**
	 * The pre-rendered check-in block. Passed in rather than built here, because
	 * producing it needs Prisma, the QR encoder and an inline attachment. Defaults to
	 * empty, which is also correct for a recipient with no pass.
	 */
	checkInPass = '',
	/** See `buildEventVars`: the server-built walk-in URL this module cannot make. */
	walkInLink = ''
): Record<string, string> {
	// `name` comes from a linked application question, so an account that has not
	// answered it holds `''` — and "Hi ," is worse than a filler salutation.
	return {
		name: user.name?.trim() || NAME_FALLBACK,
		...buildEventVars(settings, walkInLink),
		hacker_qr_code: checkInPass
	};
}

/**
 * The substitution map for an address with no account. `sendCustom` and the compose
 * preview both call this, so what the admin reads is what the recipient receives.
 */
export function buildExternalTemplateVars(
	settings: {
		hackathonStartDate: Date;
		RSVPDeadline: Date | null;
	},
	walkInLink = ''
): Record<string, string> {
	return buildTemplateVars({ name: NAME_FALLBACK }, settings, '', walkInLink);
}
