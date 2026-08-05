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
 * `sample` mirrors the real output format (`Date.toLocaleDateString()`), not a
 * prettier one — the preview is only useful if it shows what actually sends.
 */
export const TEMPLATE_VARIABLES = [
	{ key: 'name', label: "Hacker's full name", sample: 'Sarah Chen' },
	{ key: 'hackathon_start', label: 'Hackathon start date', sample: '4/15/2026' },
	{ key: 'rsvp_deadline', label: 'RSVP deadline', sample: '4/1/2026' }
] as const;

export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];

export const VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.key);

/** Placeholder values used by the admin preview pane. */
export const SAMPLE_VARS: Record<string, string> = Object.fromEntries(
	TEMPLATE_VARIABLES.map((v) => [v.key, v.sample])
);

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/** Replace `{{key}}` with `vars[key]`. Unknown keys are left literal. */
export function substituteVariables(template: string, vars: Record<string, string>): string {
	return template.replace(VARIABLE_PATTERN, (_, key) => vars[key] ?? `{{${key}}}`);
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
 * Build the substitution map for a real send.
 *
 * Structurally typed so callers can pass a Prisma `User`/`Settings` row without
 * this module importing Prisma.
 */
export function buildTemplateVars(
	user: { name: string },
	settings: { hackathonStartDate: Date; RSVPDeadline: Date }
): Record<string, string> {
	return {
		name: user.name,
		hackathon_start: settings.hackathonStartDate.toLocaleDateString(),
		rsvp_deadline: settings.RSVPDeadline.toLocaleDateString()
	};
}
