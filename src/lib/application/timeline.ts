import { toDate } from './window';
import type { ApplicationState } from './state';

export type MilestoneKey = 'open' | 'close' | 'decisions' | 'rsvp' | 'event';

export type Milestone = {
	key: MilestoneKey;
	label: string;
	detail: string;
	/** Null only for `decisions`, whose Settings column is nullable. */
	date: Date | null;
	/** The date is in the past. */
	done: boolean;
	/** The one milestone this applicant is currently waiting on, if any. */
	next: boolean;
};

/** Structurally typed so a Prisma `Settings` row passes as-is. */
export type TimelineDates = {
	applicationOpen: Date | string;
	applicationDeadline: Date | string;
	admissionsSend: Date | string | null;
	RSVPDeadline: Date | string;
	hackathonStartDate: Date | string;
};

const MILESTONES: { key: MilestoneKey; label: string; detail: string }[] = [
	{
		key: 'open',
		label: 'Applications open',
		detail: 'Submit your application any time before the deadline. Your progress is saved automatically.'
	},
	{
		key: 'close',
		label: 'Applications close',
		detail: 'Applications are no longer accepted after this deadline.'
	},
	{
		key: 'decisions',
		label: 'Decisions go out',
		detail: 'All applicants will receive an email with their application decision.'
	},
	{
		key: 'rsvp',
		label: 'RSVP due',
		detail: 'Confirm your participation by this date. Unconfirmed spots may be offered to applicants on the waitlist.'
	},
	{
		key: 'event',
		label: 'The hackathon begins',
		detail: 'Check in using the code available on your Account page.'
	}
];

/**
 * The milestone each funnel state is waiting on.
 *
 * Null where nothing further is scheduled for that applicant: a rejected, declined or
 * waitlisted person has no next date of their own, and a checked-in one has arrived.
 * `filling` is the exception the table can't express — before the window opens it waits
 * on `open`, after that on `close` — so `buildTimeline` overrides it.
 */
const AWAITING: Record<ApplicationState, MilestoneKey | null> = {
	filling: 'close',
	submitted: 'decisions',
	accepted: 'rsvp',
	rsvpd: 'event',
	'checked-in': null,
	waitlisted: null,
	rejected: null,
	declined: null
};

/**
 * The five funnel dates, ordered, with the applicant's position marked.
 *
 * Inputs:
 * - settings: TimelineDates | null — the Settings row, or null when none is configured
 * - state: ApplicationState — where this applicant sits in the funnel
 * - now: Date — the instant to measure against, defaulting to the current time
 *
 * Outputs:
 * - Milestone[] — the five milestones in order, or empty when settings is null. At most
 *   one carries `next`, and it is never one that has already passed.
 */
export function buildTimeline(
	settings: TimelineDates | null,
	state: ApplicationState,
	now: Date = new Date()
): Milestone[] {
	if (!settings) return [];

	const dates: Record<MilestoneKey, Date | null> = {
		open: toDate(settings.applicationOpen),
		close: toDate(settings.applicationDeadline),
		decisions: toDate(settings.admissionsSend),
		rsvp: toDate(settings.RSVPDeadline),
		event: toDate(settings.hackathonStartDate)
	};

	const opens = dates.open;
	const awaiting = state === 'filling' && opens && now < opens ? 'open' : AWAITING[state];

	return MILESTONES.map((milestone) => {
		const date = dates[milestone.key];
		// An undated milestone counts as still ahead: `admissionsSend` is null until
		// admissions pick a date, and a submitted applicant is waiting on it either way.
		const done = date != null && now > date;
		return {
			...milestone,
			date,
			done,
			next: milestone.key === awaiting && !done
		};
	});
}
