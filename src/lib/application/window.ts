/**
 * Client-side mirrors of the two date guards in the application router.
 *
 * The router stays the authority; nothing here decides whether a write is allowed, only
 * what the portal says about it. They exist because the portal was rendering a live
 * form in windows where every mutation behind it was already being refused.
 *
 * Three rules are copied deliberately and must not drift: a missing Settings row reads
 * as open, the comparisons are strict so a boundary timestamp is inside, and an
 * unparseable date reads as open (failing closed would hide the form behind a corrupt
 * column, where failing open leaves the server to refuse with a real message).
 */

export type ApplicationWindowState =
	/** Applications have not opened yet. */
	| 'before'
	/** Open for editing and submission. */
	| 'open'
	/** The deadline has passed. */
	| 'closed';

/** Structurally typed so a Prisma `Settings` row passes as-is. */
export type ApplicationWindowDates = {
	applicationOpen: Date | string;
	applicationDeadline: Date | string;
};

export type RsvpWindowDates = {
	/** Nullable in the column: no deadline means confirmations never close. */
	RSVPDeadline: Date | string | null;
};

/**
 * Per-role deadline overrides from the Settings row. All nullable — absent means fall
 * back to the global applicationOpen / applicationDeadline. A Prisma Settings row
 * passes as-is once the migration runs; callers that predate the migration pass Partial.
 */
export type PerRoleWindowDates = {
	hackerApplicationOpen: Date | string | null;
	hackerApplicationDeadline: Date | string | null;
	mentorApplicationOpen: Date | string | null;
	mentorApplicationDeadline: Date | string | null;
	judgeApplicationOpen: Date | string | null;
	judgeApplicationDeadline: Date | string | null;
	volunteerApplicationOpen: Date | string | null;
	volunteerApplicationDeadline: Date | string | null;
};

/**
 * Maps a Role enum value (which Prisma emits as a plain string) to the camelCase key
 * prefix used in the Settings row. Only the four applicant roles have overrides.
 */
const ROLE_KEY: Record<string, string | undefined> = {
	HACKER: 'hacker',
	MENTOR: 'mentor',
	JUDGE: 'judge',
	VOLUNTEER: 'volunteer'
};

/**
 * A usable Date, or null for anything that isn't one.
 *
 * Exported for `timeline.ts`, which has to read the same Settings columns and must
 * agree with the guards here on what counts as a date.
 */
export function toDate(value: Date | string | null | undefined): Date | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function applicationWindowState(
	settings: ApplicationWindowDates | null | undefined,
	now: Date = new Date()
): ApplicationWindowState {
	if (!settings) return 'open';

	const opens = toDate(settings.applicationOpen);
	const closes = toDate(settings.applicationDeadline);

	if (opens && now < opens) return 'before';
	if (closes && now > closes) return 'closed';
	return 'open';
}

/**
 * Like `applicationWindowState`, but uses the role-specific open/deadline from Settings
 * when set, falling back to the global pair when not. Callers pass the Role enum value
 * as a string — Prisma enums are plain string literals at runtime (e.g. Role.HACKER ===
 * 'HACKER'), so no import of the generated enum is needed here.
 */
export function roleApplicationWindowState(
	settings: (ApplicationWindowDates & Partial<PerRoleWindowDates>) | null | undefined,
	role: string,
	now: Date = new Date()
): ApplicationWindowState {
	if (!settings) return 'open';

	const prefix = ROLE_KEY[role];
	const s = settings as Record<string, unknown>;
	const roleOpen = prefix
		? toDate(s[`${prefix}ApplicationOpen`] as Date | string | null | undefined)
		: null;
	const roleClose = prefix
		? toDate(s[`${prefix}ApplicationDeadline`] as Date | string | null | undefined)
		: null;

	const opens = roleOpen ?? toDate(settings.applicationOpen);
	const closes = roleClose ?? toDate(settings.applicationDeadline);

	if (opens && now < opens) return 'before';
	if (closes && now > closes) return 'closed';
	return 'open';
}

/**
 * The effective open date for a role: the role-specific value when set, else the global
 * applicationOpen. Returns null when settings is absent (unconfigured install).
 */
export function effectiveRoleOpen(
	settings: (ApplicationWindowDates & Partial<PerRoleWindowDates>) | null | undefined,
	role: string
): Date | null {
	if (!settings) return null;
	const prefix = ROLE_KEY[role];
	const s = settings as Record<string, unknown>;
	const roleDate = prefix
		? toDate(s[`${prefix}ApplicationOpen`] as Date | string | null | undefined)
		: null;
	return roleDate ?? toDate(settings.applicationOpen);
}

/**
 * The effective deadline for a role: the role-specific value when set, else the global
 * applicationDeadline. Returns null when settings is absent (unconfigured install).
 */
export function effectiveRoleDeadline(
	settings: (ApplicationWindowDates & Partial<PerRoleWindowDates>) | null | undefined,
	role: string
): Date | null {
	if (!settings) return null;
	const prefix = ROLE_KEY[role];
	const s = settings as Record<string, unknown>;
	const roleDate = prefix
		? toDate(s[`${prefix}ApplicationDeadline`] as Date | string | null | undefined)
		: null;
	return roleDate ?? toDate(settings.applicationDeadline);
}

export function isRsvpClosed(
	settings: RsvpWindowDates | null | undefined,
	now: Date = new Date()
): boolean {
	if (!settings) return false;

	const deadline = toDate(settings.RSVPDeadline);
	return deadline != null && now > deadline;
}
