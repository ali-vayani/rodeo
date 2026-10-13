/**
 * When walk-in registration opens: the calendar day the event starts, in the
 * hackathon's timezone, and every day after. No end bound — the event itself is the
 * end, and refusing a day-two walk-in would be a rule nobody asked for.
 *
 * Isomorphic: the admin page greys itself out with the same call the router refuses
 * with, so the two cannot drift. Same conventions as the window guards in
 * `$lib/application/window`: a missing Settings row and an unparseable date both read
 * as unlocked, leaving the server to refuse with a real message if that is wrong.
 */

import { dayKey } from '$lib/schedule/days';
import { toDate } from '$lib/application/window';

export type WalkInUnlockSettings = {
	hackathonStartDate: Date | string;
	/** IANA identifier; the venue's day boundaries, not the viewer's. */
	timezone: string;
};

export function isWalkInUnlocked(
	settings: WalkInUnlockSettings | null | undefined,
	now: Date = new Date()
): boolean {
	if (!settings) return true;

	const start = toDate(settings.hackathonStartDate);
	if (!start) return true;

	try {
		// dayKey renders YYYY-MM-DD, which compares as a plain string.
		return dayKey(now, settings.timezone) >= dayKey(start, settings.timezone);
	} catch {
		// An invalid timezone throws inside Intl. The admin typed it; fail open.
		return true;
	}
}
