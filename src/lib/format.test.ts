import { describe, it, expect } from 'vitest';
import {
	EM_DASH,
	formatDate,
	formatDateLong,
	formatTime,
	formatDateTime,
	humanizeEnum,
	initials,
	pluralize
} from './format';

// Fixed instant so these never depend on when the suite runs.
const NOON = new Date('2026-09-12T17:30:00Z');

describe('formatDate', () => {
	it('includes the year by default', () => {
		expect(formatDate(NOON)).toBe('Sep 12, 2026');
	});

	it('drops the year when asked', () => {
		expect(formatDate(NOON, { year: false })).toBe('Sep 12');
	});

	it('accepts a string or a number', () => {
		expect(formatDate('2026-09-12T17:30:00Z')).toBe('Sep 12, 2026');
		expect(formatDate(NOON.getTime())).toBe('Sep 12, 2026');
	});

	it('returns an em dash rather than "Invalid Date"', () => {
		expect(formatDate(null)).toBe(EM_DASH);
		expect(formatDate(undefined)).toBe(EM_DASH);
		expect(formatDate('not a date')).toBe(EM_DASH);
		expect(formatDate(new Date('nope'))).toBe(EM_DASH);
	});
});

describe('formatDateLong', () => {
	it('spells the month out', () => {
		expect(formatDateLong(NOON)).toBe('September 12, 2026');
	});
});

describe('formatTime', () => {
	it('formats in a given timezone', () => {
		expect(formatTime(NOON, 'UTC')).toBe('5:30 PM');
	});

	it('handles absent values', () => {
		expect(formatTime(null)).toBe(EM_DASH);
	});
});

describe('formatDateTime', () => {
	it('joins the date and the time', () => {
		expect(formatDateTime(NOON, 'UTC')).toBe('Sep 12, 5:30 PM');
	});
});

describe('humanizeEnum', () => {
	it('turns SCREAMING_CASE into a sentence', () => {
		expect(humanizeEnum('CHECKED_IN')).toBe('Checked in');
		expect(humanizeEnum('ACCEPTED')).toBe('Accepted');
		expect(humanizeEnum('MULTIPLE_CHOICE')).toBe('Multiple choice');
	});

	it('returns an em dash for absent values', () => {
		expect(humanizeEnum(null)).toBe(EM_DASH);
		expect(humanizeEnum('')).toBe(EM_DASH);
	});
});

describe('initials', () => {
	it('takes the first and last name', () => {
		expect(initials('Priya Raman')).toBe('PR');
	});

	it('skips middle names', () => {
		expect(initials('Ada Byron Lovelace')).toBe('AL');
	});

	it('falls back to two characters for a mononym', () => {
		expect(initials('Prince')).toBe('PR');
	});

	it('tolerates ragged whitespace', () => {
		expect(initials('  marcus   webb  ')).toBe('MW');
	});
});

describe('pluralize', () => {
	it('drops the s at one', () => {
		expect(pluralize(1, 'entry', 'entries')).toBe('1 entry');
		expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
	});

	it('defaults to a trailing s', () => {
		expect(pluralize(0, 'row')).toBe('0 rows');
	});
});
