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

export function isRsvpClosed(
	settings: RsvpWindowDates | null | undefined,
	now: Date = new Date()
): boolean {
	if (!settings) return false;

	const deadline = toDate(settings.RSVPDeadline);
	return deadline != null && now > deadline;
}
