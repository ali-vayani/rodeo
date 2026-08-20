/**
 * Day bucketing and time formatting for the schedule.
 *
 * Everything here works in the hackathon's configured timezone rather than the
 * browser's. An organizer editing from another timezone must see the same day
 * boundaries as the attendees in the venue, or a 9pm event lands under the wrong tab.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23', // not hour12:false — that yields hour "24" on some engines
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

/** The wall-clock fields an instant shows when read in `timeZone`. */
function wallClock(date: Date, timeZone: string) {
	const parts: Record<string, string> = {};
	for (const { type, value } of wallClockFormatter(timeZone).formatToParts(date)) {
		parts[type] = value;
	}
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour: Number(parts.hour),
		minute: Number(parts.minute),
		second: Number(parts.second)
	};
}

/** How far `timeZone` sits from UTC at `date`, in ms. Varies with DST. */
function offsetMs(date: Date, timeZone: string): number {
	const w = wallClock(date, timeZone);
	return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - date.getTime();
}

/**
 * Renders an instant as the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">`
 * expects, using the wall clock of `timeZone` and NOT the browser's.
 *
 * `toDatetimeLocal()` in $lib/utils is the browser-local equivalent, which here would
 * show an admin in Los Angeles a different time than the event card beside it.
 */
export function toZonedInput(date: Date, timeZone: string): string {
	const w = wallClock(date, timeZone);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * Inverse of `toZonedInput`: reads a datetime-local value as a wall clock in
 * `timeZone` and returns the instant it names. The stored value stays UTC — only
 * its interpretation is pinned to the hackathon's timezone.
 */
export function fromZonedInput(value: string, timeZone: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!m) return new Date(NaN);
	const asIfUtc = Date.UTC(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		Number(m[4]),
		Number(m[5])
	);
	// The offset depends on the instant, which depends on the offset. One guess
	// then one correction settles it; they differ only near a DST transition.
	const firstGuess = asIfUtc - offsetMs(new Date(asIfUtc), timeZone);
	return new Date(asIfUtc - offsetMs(new Date(firstGuess), timeZone));
}

/** Calendar date of `date` in `timeZone`, as `YYYY-MM-DD`. */
export function dayKey(date: Date, timeZone: string): string {
	// en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
}

/** The calendar day after `key`. Steps through UTC so DST never adds or drops a day. */
export function nextDayKey(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

/** `"2025-11-15"` → `"Nov 15"`. Formatted in UTC because the key is already a wall date. */
export function formatDayLabel(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		month: 'short',
		day: 'numeric'
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `"9:00 AM"` in the hackathon timezone. */
export function formatTime(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}
