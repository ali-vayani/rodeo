import { UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';

export type ApplicationState =
	| 'filling'
	| 'submitted'
	| 'waitlisted'
	| 'accepted'
	| 'rejected'
	| 'rsvpd'
	| 'declined'
	| 'checked-in';

export type ApplicationUser = {
	status: UserStatus;
	activeDecision: DecisionStatus | null;
};

/**
 * Where an applicant is in the funnel, for the portal's status banner.
 *
 * Post-RSVP status outranks the decision: a CONFIRMED or DECLINED user still holds an
 * ACCEPTED decision, and what they did with it is the more recent fact.
 */
export function computeApplicationState(user: ApplicationUser): ApplicationState {
	if (user.status === UserStatus.CONFIRMED) return 'rsvpd';
	if (user.status === UserStatus.CHECKED_IN) return 'checked-in';
	if (user.status === UserStatus.DECLINED) return 'declined';
	if (user.activeDecision === DecisionStatus.ACCEPTED) return 'accepted';
	if (user.activeDecision === DecisionStatus.WAITLISTED) return 'waitlisted';
	if (user.activeDecision === DecisionStatus.REJECTED) return 'rejected';
	if (user.status === UserStatus.APPLIED) return 'submitted';
	return 'filling';
}

const APPLICATION_STATE_LABELS: Record<Exclude<ApplicationState, 'filling'>, string> = {
	'checked-in': 'Checked In',
	rsvpd: 'Confirmed',
	declined: 'Declined',
	accepted: 'Accepted',
	waitlisted: 'Waitlisted',
	rejected: 'Rejected',
	submitted: 'Applied'
};

export function getApplicationStateLabel(user: ApplicationUser): string | null {
	const state = computeApplicationState(user);
	if (state === 'filling') return null;
	return APPLICATION_STATE_LABELS[state];
}
