import { describe, it, expect } from 'vitest';
import { UserStatus } from '$lib/generated/prisma/enums';
import {
	isWalletPassEligible,
	walletPassIneligibility,
	WALLET_INELIGIBLE_MESSAGE,
	type WalletPassSubject
} from './eligibility';

const DEADLINE = new Date('2026-03-01T00:00:00.000Z');
const BEFORE = new Date('2026-02-28T23:59:59.000Z');
const AFTER = new Date('2026-03-01T00:00:01.000Z');
const EVENT_START = new Date('2026-03-06T00:00:00.000Z');

const settings = { RSVPDeadline: DEADLINE, hackathonStartDate: EVENT_START };
const confirmed: WalletPassSubject = { status: UserStatus.CONFIRMED };

describe('walletPassIneligibility', () => {
	it('admits a confirmed attendee once the RSVP deadline has passed', () => {
		expect(walletPassIneligibility(confirmed, settings, AFTER)).toBeNull();
		expect(isWalletPassEligible(confirmed, settings, AFTER)).toBe(true);
	});

	it('admits someone who has already checked in', () => {
		// Whoever lost their pass and is standing at the front desk is exactly who
		// still needs one.
		const checkedIn = { status: UserStatus.CHECKED_IN };
		expect(isWalletPassEligible(checkedIn, settings, AFTER)).toBe(true);
	});

	it.each([UserStatus.CREATED, UserStatus.APPLIED, UserStatus.DECLINED])(
		'refuses a %s account on the status, not the deadline',
		(status) => {
			// The status check runs first so the message names the real obstacle. Telling
			// someone who declined their spot to wait for a deadline would be a lie.
			expect(walletPassIneligibility({ status }, settings, AFTER)).toBe('NOT_CONFIRMED');
		}
	);

	it('refuses a confirmed attendee while the RSVP window is still open', () => {
		expect(walletPassIneligibility(confirmed, settings, BEFORE)).toBe('RSVP_STILL_OPEN');
		expect(isWalletPassEligible(confirmed, settings, BEFORE)).toBe(false);
	});

	it('refuses at the exact instant of the deadline', () => {
		// `isWalletUnlocked` compares with a strict `>`, matching `isRsvpClosed`, so a
		// timestamp sitting exactly on the boundary is still inside the RSVP window.
		// Matching that here keeps the pass and the RSVP button from disagreeing for
		// one second.
		expect(walletPassIneligibility(confirmed, settings, DEADLINE)).toBe('RSVP_STILL_OPEN');
	});

	// ---------------------------------------------------------------------------
	// No RSVP deadline: the unlock latches onto the event start.
	// ---------------------------------------------------------------------------

	it('latches to the event start when no RSVP deadline is set', () => {
		const noDeadline = { RSVPDeadline: null, hackathonStartDate: EVENT_START };
		const afterStart = new Date('2026-03-06T00:00:01.000Z');
		expect(walletPassIneligibility(confirmed, noDeadline, EVENT_START)).toBe('RSVP_STILL_OPEN');
		expect(walletPassIneligibility(confirmed, noDeadline, afterStart)).toBeNull();
	});

	// ---------------------------------------------------------------------------
	// Polarity pins. See the long comment in ./eligibility.ts.
	//
	// These assert that missing or broken unlock dates yield no pass. If either fails,
	// someone changed `walletUnlockDate`'s degenerate cases and this gate has silently
	// become fail-open. Fix the gate. Do not fix the test.
	// ---------------------------------------------------------------------------

	it('is unavailable when Settings is missing', () => {
		expect(walletPassIneligibility(confirmed, null, AFTER)).toBe('RSVP_STILL_OPEN');
		expect(isWalletPassEligible(confirmed, undefined, AFTER)).toBe(false);
	});

	it('is unavailable when both unlock dates are unparseable', () => {
		const corrupt = { RSVPDeadline: 'not a date', hackathonStartDate: 'also not a date' };
		expect(walletPassIneligibility(confirmed, corrupt, AFTER)).toBe('RSVP_STILL_OPEN');
	});
});

describe('WALLET_INELIGIBLE_MESSAGE', () => {
	it('has a message for every reason', () => {
		// The card indexes this record by whatever reason it is handed, so a missing
		// key renders `undefined` to a hacker.
		expect(Object.keys(WALLET_INELIGIBLE_MESSAGE).sort()).toEqual([
			'NOT_CONFIRMED',
			'RSVP_STILL_OPEN'
		]);
	});
});
