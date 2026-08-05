import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Formats a Date for an `<input type="datetime-local">`, whose value must be a
 * bare `YYYY-MM-DDTHH:mm` with no zone. Built from the local getters rather than
 * `toISOString()` so the displayed time matches the wall clock the admin is in.
 */
export function toDatetimeLocal(d: Date | null | undefined): string {
	if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
