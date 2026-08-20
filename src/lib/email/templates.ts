/**
 * The registry of lifecycle email templates.
 *
 * Isomorphic, like `./variables` — the admin editor renders `EMAIL_TEMPLATES`
 * directly, and the routers use `TEMPLATE_KEYS` to validate input and to derive
 * the `Settings` column names.
 */

/**
 * `key` doubles as the `Settings` column prefix: `submit` gives `submitTemplate` and
 * `submitSubject`. `label` names the resulting UserStatus or decision rather than the
 * column, which is how organizers think about it.
 */
export const EMAIL_TEMPLATES = [
	{
		key: 'submit',
		label: 'Applied',
		description: 'Sent when a hacker submits their application.'
	},
	{
		key: 'accept',
		label: 'Accepted',
		description: 'Sent when an ACCEPTED decision is released.'
	},
	{
		key: 'reject',
		label: 'Rejected',
		description: 'Sent when a REJECTED decision is released.'
	},
	{
		key: 'waitlist',
		label: 'Waitlisted',
		description: 'Sent when a WAITLISTED decision is released.'
	},
	{
		key: 'confirm',
		label: 'RSVP Confirmed',
		description: 'Sent when a hacker confirms their spot.'
	},
	{
		key: 'decline',
		label: 'RSVP Declined',
		description: 'Sent when a hacker releases their spot.'
	}
] as const;

export type TemplateKey = (typeof EMAIL_TEMPLATES)[number]['key'];

/** Tuple form, for `z.enum`. The guards below keep it in sync with EMAIL_TEMPLATES. */
export const TEMPLATE_KEYS = [
	'submit',
	'accept',
	'reject',
	'waitlist',
	'confirm',
	'decline'
] as const;

// Compile-time guards, both directions: adding a template to one list without the
// other is a type error rather than a silently unvalidated key.
const _subset: readonly TemplateKey[] = TEMPLATE_KEYS;
const _superset: readonly (typeof TEMPLATE_KEYS)[number][] = EMAIL_TEMPLATES.map((t) => t.key);
void _subset;
void _superset;
