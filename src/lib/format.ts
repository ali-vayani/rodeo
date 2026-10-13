/**
 * Display formatting shared across the app.
 *
 * These existed as five copies of `formatDate`, two of `initials` and four of
 * `decLabel`. Copies drift: the old `decLabel` returned `''` in one component and
 * `'—'` in three others for the same null input.
 */

/** What every formatter returns for a null/absent value. */
export const EM_DASH = '—';

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `Sep 12, 2026` — the default for anything shown in a table or a detail pane.
 *
 * Pass `year: false` for the compact `Sep 12` used where the column is narrow
 * and the year is obvious from context.
 */
export function formatDate(value: DateInput, options?: { year?: boolean }): string {
	const date = toDate(value);
	if (!date) return EM_DASH;

	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(options?.year === false ? {} : { year: 'numeric' })
	});
}

/** `September 12, 2026` — for prose in the hacker portal, not for tables. */
export function formatDateLong(value: DateInput): string {
	const date = toDate(value);
	if (!date) return EM_DASH;

	return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** `2:30 PM`. */
export function formatTime(value: DateInput, timeZone?: string): string {
	const date = toDate(value);
	if (!date) return EM_DASH;

	return date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		...(timeZone ? { timeZone } : {})
	});
}

/** `Sep 12, 2:30 PM` — the scan log and the activity feed. */
export function formatDateTime(value: DateInput, timeZone?: string): string {
	const date = toDate(value);
	if (!date) return EM_DASH;

	return `${date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(timeZone ? { timeZone } : {})
	})}, ${formatTime(date, timeZone)}`;
}

/**
 * `40s` / `12m` / `3h` / `5d` — elapsed time, for a feed where how long ago matters
 * more than the exact instant.
 *
 * Deliberately terse and unsuffixed: these sit in a narrow right-hand column where
 * "3 hours ago" would wrap. Caps at days rather than rolling over to weeks, because
 * "5w" reads as a typo more often than as five weeks.
 */
export function formatRelativeTime(value: DateInput): string {
	const date = toDate(value);
	if (!date) return EM_DASH;

	// Clamped at zero: a row written a few hundred ms into the future by clock skew
	// between the app server and the database should read "0s", never "-1s".
	const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

/**
 * `CHECKED_IN` → `Checked in`. Every enum the UI shows a user goes through
 * here, so a schema rename never leaves a raw SCREAMING_CASE string on screen.
 */
export function humanizeEnum(value: string | null | undefined): string {
	if (!value) return EM_DASH;
	const lower = value.toLowerCase().replace(/_/g, ' ');
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Avatar initials. Two letters from a first and last name where both exist, otherwise
 * the first two characters, so mononyms do not render as a single lonely letter.
 */
export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
	return name.trim().slice(0, 2).toUpperCase();
}

/** `1 entry` / `2 entries`, without an `s` bolted onto an irregular plural. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/** `812 KB` / `1.4 MB` — for file listings. Rounds up so nothing shows as `0 KB`. */
export function formatFileSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
