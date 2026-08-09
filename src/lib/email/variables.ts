/**
 * Template variable definitions and substitution.
 *
 * This module is deliberately isomorphic — it is imported by both the admin
 * email-templates editor (browser) and the tRPC routers that actually send mail
 * (server). It must therefore stay free of Prisma, node builtins, and `$env`.
 * Anything that touches transport or environment belongs in `$lib/server/email.ts`.
 */

/**
 * The single source of truth for which `{{variables}}` exist.
 *
 * A variable listed here MUST be produced by `buildTemplateVars`, otherwise the
 * editor advertises a placeholder that arrives in a hacker's inbox unsubstituted.
 * `variables.test.ts` asserts the two stay in sync.
 *
 * `placeholder` names the value rather than imitating one. Invented stand-ins — a
 * "Sarah Chen", a "4/15/2026" — read as data, so an organizer proofreading a draft
 * cannot tell a working template from one about to mail every hacker the wrong date.
 * A bracketed label can only be read one way, and it is shorter besides.
 *
 * These are only ever shown where there is no concrete recipient to substitute. Where
 * there is one, the real values are used — see `buildTemplateVars` and the compose
 * preview, which reads the dates back from Settings.
 */
export const TEMPLATE_VARIABLES = [
	{ key: 'name', label: "Hacker's full name", placeholder: '[hacker name]' },
	{ key: 'hackathon_start', label: 'Hackathon start date', placeholder: '[start date]' },
	// Not "[end date]": this is the RSVP cutoff, not when the event ends. Labelling it
	// as an end date would be the same lie in a shorter form.
	{ key: 'rsvp_deadline', label: 'RSVP deadline', placeholder: '[RSVP deadline]' }
] as const;

export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];

export const VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.key);

/**
 * Placeholder values used where there is no concrete recipient to substitute against
 * — the lifecycle template editor, which previews a template rather than a message.
 * The custom-email compose preview does have one, and uses it instead.
 */
export const SAMPLE_VARS: Record<string, string> = Object.fromEntries(
	TEMPLATE_VARIABLES.map((v) => [v.key, v.placeholder])
);

/**
 * What `{{name}}` becomes for a recipient with no account.
 *
 * A custom email can be sent to an arbitrary address — a sponsor, a judge — and there
 * is no User row to read a name off. "Hi {{name}}," has to still read as a sentence,
 * so the substitution is a salutation filler rather than a name. Exported because the
 * compose preview substitutes the same value: a preview that showed anything else
 * would be lying about what lands in that inbox.
 */
export const EXTERNAL_NAME_FALLBACK = 'there';

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
 * `escapeValues` HTML-escapes each substituted value and is used for the *body* of an
 * outbound email, which is rendered through `marked` into HTML. Variable values include
 * `name`, which is user-controlled (an applicant can set it via a linked question), so
 * without escaping a name like `<script>…` or `<a href=…>` would inject live markup into
 * the message. Subjects and the admin preview pass this false — a subject is plain text,
 * and the preview escapes segments itself via Svelte.
 */
export function substituteVariables(
	template: string,
	vars: Record<string, string>,
	{ escapeValues = false }: { escapeValues?: boolean } = {}
): string {
	return template.replace(VARIABLE_PATTERN, (_, key) => {
		const value = vars[key];
		if (value === undefined) return `{{${key}}}`;
		return escapeValues ? escapeHtml(value) : value;
	});
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
 * The half of the substitution map that doesn't depend on who receives the message.
 *
 * Split out so the server can render these strings once and hand them to the compose
 * preview. Formatting them in the browser instead would run `toLocaleDateString()`
 * under the *viewer's* locale and timezone, and a preview that reads 4/14 for a send
 * that renders 4/15 is worse than no preview at all.
 */
export function buildEventVars(settings: {
	hackathonStartDate: Date;
	RSVPDeadline: Date;
}): Record<string, string> {
	return {
		hackathon_start: settings.hackathonStartDate.toLocaleDateString(),
		rsvp_deadline: settings.RSVPDeadline.toLocaleDateString()
	};
}

/**
 * Build the substitution map for a real send.
 *
 * Structurally typed so callers can pass a Prisma `User`/`Settings` row without
 * this module importing Prisma.
 */
export function buildTemplateVars(
	user: { name: string },
	settings: { hackathonStartDate: Date; RSVPDeadline: Date }
): Record<string, string> {
	return { name: user.name, ...buildEventVars(settings) };
}

/**
 * The substitution map for an address with no account.
 *
 * Same event dates, generic salutation. `sendCustom` and the compose preview both
 * call this, so what the admin reads is what the external recipient receives.
 */
export function buildExternalTemplateVars(settings: {
	hackathonStartDate: Date;
	RSVPDeadline: Date;
}): Record<string, string> {
	return buildTemplateVars({ name: EXTERNAL_NAME_FALLBACK }, settings);
}
