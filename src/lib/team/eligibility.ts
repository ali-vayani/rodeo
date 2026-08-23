// The enums module, not the client barrel: this file is imported by a Svelte
// component's props type as well as by the server, and the barrel drags in the
// Node-only Prisma runtime.
import { DecisionStatus, Role, UserStatus } from '$lib/generated/prisma/enums';

/**
 * Who may be on a team: a HACKER (judges and mentors clear the same accept/confirm
 * funnel, so status alone said yes to them), ACCEPTED (so a rejected applicant cannot
 * use `inviteMember` as an existence oracle), and CONFIRMED or CHECKED_IN.
 *
 * One definition, enforced on every path that puts a person on a team and read by the
 * layout that renders the invite banner.
 */
export type TeamEligibilitySubject = {
	role: Role;
	activeDecision: DecisionStatus | null;
	status: UserStatus;
};

/** Why an account may not be on a team, or `null` when it may. */
export type TeamIneligibility = 'NOT_HACKER' | 'NOT_CONFIRMED';

/**
 * Role is checked before status so a judge or mentor, who clears the same confirm
 * funnel, is told "not a hacker" rather than "go confirm your spot".
 */
export function teamIneligibility(user: TeamEligibilitySubject): TeamIneligibility | null {
	if (user.role !== Role.HACKER) return 'NOT_HACKER';
	if (user.activeDecision !== DecisionStatus.ACCEPTED) return 'NOT_CONFIRMED';
	if (user.status !== UserStatus.CONFIRMED && user.status !== UserStatus.CHECKED_IN) {
		return 'NOT_CONFIRMED';
	}
	return null;
}

export function isTeamEligible(user: TeamEligibilitySubject): boolean {
	return teamIneligibility(user) === null;
}

/**
 * What to tell the person about their own account. `inviteMember` deliberately says
 * nothing about an invitee, since naming the reason would turn it into a probe.
 */
export const TEAM_INELIGIBLE_MESSAGE: Record<TeamIneligibility, string> = {
	NOT_HACKER: 'Teams are for hackers. This account is registered under a different role.',
	NOT_CONFIRMED: 'You must be a confirmed attendee to join or manage a team.'
};
