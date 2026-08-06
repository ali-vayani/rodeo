// The enums module, not the client barrel: this file is imported by a Svelte
// component's props type as well as by the server, and the barrel drags in the
// Node-only Prisma runtime. Same reason $lib/auth/permissions does it.
import { DecisionStatus, Role, UserStatus } from '$lib/generated/prisma/enums';

/**
 * Who may be on a team.
 *
 * Three conditions, and they are not the same condition:
 *
 *   - a HACKER, because teams are the thing hackers submit projects as. Judges,
 *     mentors and volunteers all reach /hacker/* (see `canAccessHackerPortal`) and
 *     all go through the same accept/confirm funnel the seed gives them, so status
 *     alone said yes to a judge holding a copied invite link.
 *   - ACCEPTED, so a rejected applicant can't open a team and use `inviteMember`
 *     as an existence oracle.
 *   - CONFIRMED or CHECKED_IN, so a team is made of people who are actually coming.
 *
 * One definition, enforced on every path that puts a person on a team — and read
 * by the layout that renders the invite banner, which used to keep its own copy of
 * the status half and therefore lit the Join button up for judges.
 */
export type TeamEligibilitySubject = {
	roles: Role[];
	activeDecision: DecisionStatus | null;
	status: UserStatus;
};

/** Why an account may not be on a team, or `null` when it may. */
export type TeamIneligibility = 'NOT_HACKER' | 'NOT_CONFIRMED';

export function teamIneligibility(user: TeamEligibilitySubject): TeamIneligibility | null {
	if (!user.roles.includes(Role.HACKER)) return 'NOT_HACKER';
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
 * What to tell the person about their own account.
 *
 * Only ever shown to the account it describes — `inviteMember` deliberately says
 * nothing at all about an invitee, since naming the reason would turn the endpoint
 * into a probe for who registered and who got in.
 */
export const TEAM_INELIGIBLE_MESSAGE: Record<TeamIneligibility, string> = {
	NOT_HACKER: 'Teams are for hackers. This account is registered under a different role.',
	NOT_CONFIRMED: 'You must be a confirmed attendee to join or manage a team.'
};
