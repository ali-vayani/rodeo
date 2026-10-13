import { describe, it, expect } from 'vitest';
import { isWalkInUnlocked } from './unlock';

// 2026-04-18 09:00 in Chicago (UTC-5 in April) is 14:00 UTC.
const settings = {
	hackathonStartDate: new Date('2026-04-18T14:00:00Z'),
	timezone: 'America/Chicago'
};

describe('isWalkInUnlocked', () => {
	it('is locked the day before the event', () => {
		expect(isWalkInUnlocked(settings, new Date('2026-04-17T23:00:00-05:00'))).toBe(false);
	});

	it('unlocks at midnight in the event timezone, not at the start time', () => {
		// 00:30 Chicago on event day, hours before the 09:00 start.
		expect(isWalkInUnlocked(settings, new Date('2026-04-18T00:30:00-05:00'))).toBe(true);
	});

	it('uses the venue day, not the viewer or server day', () => {
		// 04:00 UTC on the 18th is still 23:00 on the 17th in Chicago.
		expect(isWalkInUnlocked(settings, new Date('2026-04-18T04:00:00Z'))).toBe(false);
	});

	it('stays unlocked on later days — the event is the end bound', () => {
		expect(isWalkInUnlocked(settings, new Date('2026-04-19T12:00:00-05:00'))).toBe(true);
	});

	it('reads a missing Settings row as unlocked, like the window guards', () => {
		expect(isWalkInUnlocked(null)).toBe(true);
	});

	it('fails open on an unparseable date or timezone', () => {
		expect(isWalkInUnlocked({ ...settings, hackathonStartDate: 'garbage' })).toBe(true);
		expect(
			isWalkInUnlocked({ ...settings, timezone: 'Not/AZone' }, new Date('2026-01-01T00:00:00Z'))
		).toBe(true);
	});
});
