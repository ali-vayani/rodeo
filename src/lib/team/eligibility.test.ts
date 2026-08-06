import { describe, it, expect } from 'vitest';
import { DecisionStatus, Role, UserStatus } from '$lib/generated/prisma/enums';
import {
	isTeamEligible,
	teamIneligibility,
	TEAM_INELIGIBLE_MESSAGE,
	type TeamEligibilitySubject
} from './eligibility';

/** A confirmed hacker — the one shape that may be on a team. */
const confirmedHacker: TeamEligibilitySubject = {
	role: Role.HACKER,
	activeDecision: DecisionStatus.ACCEPTED,
	status: UserStatus.CONFIRMED
};

describe('teamIneligibility', () => {
	it('admits a confirmed hacker', () => {
		expect(teamIneligibility(confirmedHacker)).toBeNull();
		expect(isTeamEligible(confirmedHacker)).toBe(true);
	});

	it('admits a hacker who has already checked in', () => {
		// Someone at the front desk on day one is exactly who still needs a team.
		expect(isTeamEligible({ ...confirmedHacker, status: UserStatus.CHECKED_IN })).toBe(true);
	});

	it.each([Role.JUDGE, Role.MENTOR, Role.VOLUNTEER, Role.ORGANIZER, Role.UNDECLARED])(
		'refuses a confirmed %s on the role, not the RSVP',
		(role) => {
			// These accounts go through the same accept/confirm funnel a hacker does, so
			// the status half of the rule says yes to all of them. The reason has to be
			// the role one or the banner tells a judge to go and confirm a spot they
			// already confirmed.
			expect(teamIneligibility({ ...confirmedHacker, role })).toBe('NOT_HACKER');
		}
	);

	it('refuses staff outright, since they hold no hacker role to be eligible with', () => {
		// There is no longer a "both staff and a hacker" account to admit: roles are
		// exclusive, so taking ADMIN is what gives up the team, not an extra flag on it.
		expect(teamIneligibility({ ...confirmedHacker, role: Role.ADMIN })).toBe('NOT_HACKER');
	});

	it('refuses a hacker who has not been accepted', () => {
		expect(teamIneligibility({ ...confirmedHacker, activeDecision: null })).toBe('NOT_CONFIRMED');
		expect(
			teamIneligibility({ ...confirmedHacker, activeDecision: DecisionStatus.WAITLISTED })
		).toBe('NOT_CONFIRMED');
		expect(teamIneligibility({ ...confirmedHacker, activeDecision: DecisionStatus.REJECTED })).toBe(
			'NOT_CONFIRMED'
		);
	});

	it('refuses an accepted hacker who has not RSVPd', () => {
		expect(teamIneligibility({ ...confirmedHacker, status: UserStatus.APPLIED })).toBe(
			'NOT_CONFIRMED'
		);
	});

	it('refuses an accepted hacker who declined their spot', () => {
		// The stale-invitation case: invited while CONFIRMED, declined since.
		expect(teamIneligibility({ ...confirmedHacker, status: UserStatus.DECLINED })).toBe(
			'NOT_CONFIRMED'
		);
	});

	it('checks the role before the status, so a non-hacker is never told to confirm', () => {
		const judgeWhoNeverApplied: TeamEligibilitySubject = {
			role: Role.JUDGE,
			activeDecision: null,
			status: UserStatus.CREATED
		};

		expect(teamIneligibility(judgeWhoNeverApplied)).toBe('NOT_HACKER');
		expect(TEAM_INELIGIBLE_MESSAGE.NOT_HACKER).not.toContain('confirm');
	});
});
