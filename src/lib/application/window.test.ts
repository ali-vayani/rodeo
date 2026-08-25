import { describe, it, expect } from 'vitest';
import { applicationWindowState, isRsvpClosed } from './window';

const OPENS = new Date('2026-04-01T00:00:00Z');
const CLOSES = new Date('2026-04-15T00:00:00Z');
const WINDOW = { applicationOpen: OPENS, applicationDeadline: CLOSES };

describe('applicationWindowState', () => {
	it('reports before, open and closed across the window', () => {
		expect(applicationWindowState(WINDOW, new Date('2026-03-31T23:59:59Z'))).toBe('before');
		expect(applicationWindowState(WINDOW, new Date('2026-04-07T12:00:00Z'))).toBe('open');
		expect(applicationWindowState(WINDOW, new Date('2026-04-15T00:00:01Z'))).toBe('closed');
	});

	it('treats both boundaries as inside the window', () => {
		// The server compares with `<` and `>`, so an instant exactly on a boundary is
		// allowed. A UI that closed one millisecond early would refuse a submission the
		// server would have taken.
		expect(applicationWindowState(WINDOW, OPENS)).toBe('open');
		expect(applicationWindowState(WINDOW, CLOSES)).toBe('open');
	});

	it('reads a missing Settings row as open', () => {
		// Mirrors `assertWithinApplicationWindow(null)`, which returns without throwing.
		// Reading "unconfigured" as "closed" would lock applicants out of an event
		// nobody has set up yet.
		expect(applicationWindowState(null)).toBe('open');
		expect(applicationWindowState(undefined)).toBe('open');
	});

	it('accepts serialized dates', () => {
		const serialized = {
			applicationOpen: OPENS.toISOString(),
			applicationDeadline: CLOSES.toISOString()
		};
		expect(applicationWindowState(serialized, new Date('2026-04-20T00:00:00Z'))).toBe('closed');
	});

	it('falls open on an unparseable date rather than hiding the form', () => {
		expect(
			applicationWindowState(
				{ applicationOpen: 'not a date', applicationDeadline: 'not a date' },
				new Date('2026-04-20T00:00:00Z')
			)
		).toBe('open');
	});

	it('still enforces the half of the window that is readable', () => {
		expect(
			applicationWindowState(
				{ applicationOpen: 'garbage', applicationDeadline: CLOSES },
				new Date('2026-04-20T00:00:00Z')
			)
		).toBe('closed');
	});
});

describe('isRsvpClosed', () => {
	const RSVP = { RSVPDeadline: CLOSES };

	it('is closed only after the deadline', () => {
		expect(isRsvpClosed(RSVP, new Date('2026-04-14T00:00:00Z'))).toBe(false);
		expect(isRsvpClosed(RSVP, CLOSES)).toBe(false);
		expect(isRsvpClosed(RSVP, new Date('2026-04-15T00:00:01Z'))).toBe(true);
	});

	it('reads a missing Settings row as open', () => {
		expect(isRsvpClosed(null)).toBe(false);
	});

	it('reads a null deadline as open — confirmations never close', () => {
		expect(isRsvpClosed({ RSVPDeadline: null }, new Date('2099-01-01T00:00:00Z'))).toBe(false);
	});

	it('falls open on an unparseable deadline', () => {
		expect(isRsvpClosed({ RSVPDeadline: 'garbage' }, new Date('2026-04-20T00:00:00Z'))).toBe(false);
	});
});
