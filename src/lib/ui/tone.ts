/**
 * The single mapping from a domain enum to a visual tone.
 *
 * Rodeo is monochrome, so color carries exactly one meaning: status. That only works if
 * a given status is the same color everywhere, which it was not. `DECISION_CLASS`
 * existed as five verbatim copies, so a decision could drift to a different green
 * depending on which table you were looking at.
 *
 * Components never map an enum to a class. They map it to a `Tone` here, and `Badge`
 * owns what a tone looks like.
 */

import type { DecisionStatus, UserStatus, ScheduleType } from '$lib/generated/prisma/enums';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Accepted reads as success, rejected as danger, waitlisted as warning —
 * waitlist is genuinely in-between, not bad news, so amber rather than red.
 * A null decision means nobody has looked yet, which is neutral, not pending.
 */
export function decisionTone(decision: DecisionStatus | null | undefined): Tone {
	switch (decision) {
		case 'ACCEPTED':
			return 'success';
		case 'REJECTED':
			return 'danger';
		case 'WAITLISTED':
			return 'warning';
		case 'PENDING':
			return 'neutral';
		default:
			return 'neutral';
	}
}

/**
 * Status is progress through the funnel, so only its endpoints get color: CONFIRMED and
 * CHECKED_IN are the states an organizer wants to spot in a table, and DECLINED is a
 * real loss. CREATED and APPLIED are the common case and stay quiet.
 */
export function statusTone(status: UserStatus | null | undefined): Tone {
	switch (status) {
		case 'CHECKED_IN':
			return 'info';
		case 'CONFIRMED':
			return 'success';
		case 'DECLINED':
			return 'danger';
		case 'CREATED':
		case 'APPLIED':
			return 'neutral';
		default:
			return 'neutral';
	}
}

/** Schedule types are categories, not severities — tone is a legibility aid. */
export function scheduleTypeTone(type: ScheduleType | null | undefined): Tone {
	switch (type) {
		case 'MEAL':
			return 'warning';
		case 'WORKSHOP':
			return 'info';
		case 'CEREMONY':
			return 'success';
		case 'EVENT':
			return 'neutral';
		default:
			return 'neutral';
	}
}
