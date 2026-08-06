/**
 * Client-side mirrors of the two date guards in the application router.
 *
 * `assertWithinApplicationWindow` and `assertBeforeRSVPDeadline` stay the authority —
 * nothing here decides whether a write is allowed, only what the hacker portal says
 * about it. They exist because the portal was rendering a live form and a live RSVP
 * button in windows where every mutation behind them was already being refused, so a
 * closed deadline was indistinguishable from a broken page.
 *
 * Three rules are copied deliberately and must not drift from the server:
 *
 *  1. A missing Settings row means no window is enforced, so it reads as open. See
 *     the long comment on `assertWithinApplicationWindow` for why "unconfigured"
 *     must not lock applicants out of an event nobody has set up yet.
 *  2. The comparisons are strict, so a timestamp exactly on a boundary is inside the
 *     window — same as the server's `<` and `>`.
 *  3. An unparseable date reads as open. Failing closed here would hide the form
 *     behind a corrupt column; failing open leaves the server to refuse the write
 *     with a real message, which is the strictly better failure.
 *
 * `now` is a parameter so this is testable without faking the clock. Callers pass
 * nothing and get one reading taken at render — a page left open across the exact
 * moment of a deadline keeps its old rendering until something re-renders it, which
 * is fine precisely because these functions decide nothing.
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
	RSVPDeadline: Date | string;
};

/** A usable Date, or null for anything that isn't one. */
function toDate(value: Date | string | null | undefined): Date | null {
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
