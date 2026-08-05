import { describe, it, expect } from 'vitest';
import { toZonedInput, fromZonedInput, formatTime, dayKey, nextDayKey } from './days';

const TZ = 'America/Chicago';

/**
 * Regression coverage for the schedule form reading its datetime-local fields as
 * browser-local while the event cards rendered them in Settings.timezone. An admin
 * on a Los Angeles machine typed 9:00 AM and saw 11:00 AM. These assertions are
 * written so they fail if either half of the conversion drifts back.
 */
describe('datetime-local <-> instant, pinned to the hackathon timezone', () => {
	it('stores the wall clock the admin typed, not the browser one', () => {
		const d = fromZonedInput('2026-08-04T09:00', TZ);
		expect(d.toISOString()).toBe('2026-08-04T14:00:00.000Z'); // 9am CDT
		expect(formatTime(d, TZ)).toBe('9:00 AM'); // displays as typed
	});

	it('prefills the edit form with the time shown on the card', () => {
		const stored = new Date('2026-08-04T14:00:00.000Z');
		expect(toZonedInput(stored, TZ)).toBe('2026-08-04T09:00');
		expect(formatTime(stored, TZ)).toBe('9:00 AM');
	});

	it('round-trips input -> instant -> input', () => {
		for (const value of ['2026-08-04T09:00', '2026-01-15T23:30', '2026-06-30T00:00']) {
			expect(toZonedInput(fromZonedInput(value, TZ), TZ)).toBe(value);
		}
	});

	it('resolves the spring-forward transition', () => {
		// 2026-03-08: US clocks jump 2:00 -> 3:00, CST (UTC-6) to CDT (UTC-5)
		expect(fromZonedInput('2026-03-08T01:30', TZ).toISOString()).toBe('2026-03-08T07:30:00.000Z');
		expect(fromZonedInput('2026-03-08T03:30', TZ).toISOString()).toBe('2026-03-08T08:30:00.000Z');
	});

	it('resolves fall-back and sub-hour offsets', () => {
		expect(fromZonedInput('2026-11-01T00:30', TZ).toISOString()).toBe('2026-11-01T05:30:00.000Z');
		expect(fromZonedInput('2026-08-04T09:00', 'Asia/Kolkata').toISOString()).toBe(
			'2026-08-04T03:30:00.000Z' // UTC+5:30
		);
		expect(toZonedInput(new Date('2026-08-04T03:30:00.000Z'), 'Asia/Kolkata')).toBe(
			'2026-08-04T09:00'
		);
	});

	it('returns an invalid date for malformed input', () => {
		expect(fromZonedInput('', TZ).getTime()).toBeNaN();
		expect(fromZonedInput('not-a-date', TZ).getTime()).toBeNaN();
	});
});

describe('day bucketing', () => {
	it('keeps a late-evening event on the local day, not the UTC one', () => {
		// 11pm Chicago Aug 4 is already Aug 5 in UTC
		const d = fromZonedInput('2026-08-04T23:00', TZ);
		expect(d.toISOString()).toBe('2026-08-05T04:00:00.000Z');
		expect(dayKey(d, TZ)).toBe('2026-08-04');
	});

	it('steps to the next calendar day across a DST boundary', () => {
		expect(nextDayKey('2026-08-04')).toBe('2026-08-05');
		expect(nextDayKey('2026-03-07')).toBe('2026-03-08');
		expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
	});
});
