import { describe, it, expect } from 'vitest';
import { buildTimeline, type MilestoneKey } from './timeline';

const SETTINGS = {
	applicationOpen: new Date('2026-09-08T00:00:00Z'),
	applicationDeadline: new Date('2026-10-09T00:00:00Z'),
	admissionsSend: new Date('2026-10-16T00:00:00Z') as Date | null,
	RSVPDeadline: new Date('2026-10-23T00:00:00Z'),
	hackathonStartDate: new Date('2026-11-07T00:00:00Z')
};

const BEFORE_OPEN = new Date('2026-09-01T00:00:00Z');
const MID_WINDOW = new Date('2026-09-20T00:00:00Z');
const AFTER_CLOSE = new Date('2026-10-12T00:00:00Z');
const AFTER_EVENT = new Date('2026-11-20T00:00:00Z');

/** The key marked `next`, or null when nothing is. */
function nextKey(...args: Parameters<typeof buildTimeline>): MilestoneKey | null {
	return buildTimeline(...args).find((m) => m.next)?.key ?? null;
}

function doneKeys(...args: Parameters<typeof buildTimeline>): MilestoneKey[] {
	return buildTimeline(...args)
		.filter((m) => m.done)
		.map((m) => m.key);
}

describe('buildTimeline', () => {
	it('returns the five milestones in funnel order', () => {
		expect(buildTimeline(SETTINGS, 'filling', MID_WINDOW).map((m) => m.key)).toEqual([
			'open',
			'close',
			'decisions',
			'rsvp',
			'event'
		]);
	});

	it('marks only the dates that have passed as done', () => {
		expect(doneKeys(SETTINGS, 'submitted', BEFORE_OPEN)).toEqual([]);
		expect(doneKeys(SETTINGS, 'submitted', MID_WINDOW)).toEqual(['open']);
		expect(doneKeys(SETTINGS, 'submitted', AFTER_CLOSE)).toEqual(['open', 'close']);
		expect(doneKeys(SETTINGS, 'checked-in', AFTER_EVENT)).toEqual([
			'open',
			'close',
			'decisions',
			'rsvp',
			'event'
		]);
	});

	it('points an unsubmitted applicant at whichever end of the window is ahead', () => {
		expect(nextKey(SETTINGS, 'filling', BEFORE_OPEN)).toBe('open');
		expect(nextKey(SETTINGS, 'filling', MID_WINDOW)).toBe('close');
	});

	it('advances the marker as the applicant moves through the funnel', () => {
		expect(nextKey(SETTINGS, 'submitted', MID_WINDOW)).toBe('decisions');
		expect(nextKey(SETTINGS, 'accepted', MID_WINDOW)).toBe('rsvp');
		expect(nextKey(SETTINGS, 'rsvpd', MID_WINDOW)).toBe('event');
	});

	it('marks nothing for applicants with no date of their own left', () => {
		for (const state of ['waitlisted', 'rejected', 'declined', 'checked-in'] as const) {
			expect(nextKey(SETTINGS, state, MID_WINDOW)).toBeNull();
		}
	});

	it('never marks a milestone that has already passed', () => {
		// Someone who never submitted, looking at the page after the deadline. The stop
		// they were waiting on is behind them, so the trail shows no marker rather than
		// pointing at a date they missed.
		expect(nextKey(SETTINGS, 'filling', AFTER_CLOSE)).toBeNull();
		expect(nextKey(SETTINGS, 'accepted', AFTER_EVENT)).toBeNull();
	});

	it('keeps an undated decisions milestone ahead of the applicant', () => {
		// `admissionsSend` is nullable and stays null until admissions pick a date. A
		// submitted applicant is still waiting on it, so it must not read as done.
		const undated = { ...SETTINGS, admissionsSend: null };
		const decisions = buildTimeline(undated, 'submitted', AFTER_CLOSE).find(
			(m) => m.key === 'decisions'
		);
		expect(decisions).toMatchObject({ date: null, done: false, next: true });
	});

	it('accepts serialized dates', () => {
		const serialized = {
			...SETTINGS,
			applicationOpen: SETTINGS.applicationOpen.toISOString(),
			applicationDeadline: SETTINGS.applicationDeadline.toISOString()
		};
		expect(doneKeys(serialized, 'submitted', MID_WINDOW)).toEqual(['open']);
	});

	it('renders nothing when no Settings row is configured', () => {
		// Five milestones all dated "now" would be worse than an empty trail.
		expect(buildTimeline(null, 'filling', MID_WINDOW)).toEqual([]);
	});
});
