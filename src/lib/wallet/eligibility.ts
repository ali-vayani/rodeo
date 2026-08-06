// The enums module, not the client barrel: this file is imported by a Svelte
// component as well as by the server, and the barrel drags in the Node-only
// Prisma runtime. Same reason $lib/team/eligibility does it.
import { UserStatus } from '$lib/generated/prisma/enums';
import { isRsvpClosed, type RsvpWindowDates } from '$lib/application/window';

/**
 * Who may download a wallet pass.
 *
 * Two conditions. The account has to belong to someone who is actually coming —
 * CONFIRMED, or CHECKED_IN for anyone who lost their pass on the day — and the
 * RSVP deadline has to have passed, so the attendee list the passes are minted
 * against has stopped moving.
 *
 * ## The deadline check runs backwards from the application form, on purpose
 *
 * `isRsvpClosed` returns `false` for a missing Settings row and for an
 * unparseable date. `window.ts` documents that as "unconfigured reads as open",
 * and for the application form that is the generous direction: the server still
 * refuses the write, so failing open there only means the hacker sees a real
 * error instead of a blank page.
 *
 * Here the polarity inverts. This gate wants `isRsvpClosed === true`, so those
 * same degenerate cases come out as *ineligible* — no settings, no pass. That is
 * the direction we want, but it is arithmetic, not agreement: nobody wrote
 * `isRsvpClosed` intending it to protect this. A future maintainer reading
 * "unconfigured reads as open" could quite reasonably make `isRsvpClosed(null)`
 * return `true`, and every hacker in the database would get a pass.
 *
 * `eligibility.test.ts` pins both cases by name. If either of those tests fails,
 * this gate has flipped from fail-closed to fail-open — fix the gate, not the
 * test.
 *
 * ## Callers must not source `settings` from `settings.get()`
 *
 * That procedure falls back to `DEFAULT_SETTINGS`, whose `RSVPDeadline` is
 * `new Date()` evaluated at *module load*. On an install with no Settings row it
 * is therefore equal to server boot time, which is in the past for every request
 * after the first millisecond — `isRsvpClosed` would say the deadline had passed
 * and this gate would open for everybody. Server callers read
 * `prisma.settings.findFirst()` and pass `null` through unchanged; see
 * `$lib/server/wallet/guard`.
 */
export type WalletPassSubject = {
	status: UserStatus;
};

/** Why an account may not have a wallet pass, or `null` when it may. */
export type WalletIneligibility = 'NOT_CONFIRMED' | 'RSVP_STILL_OPEN';

export function walletPassIneligibility(
	user: WalletPassSubject,
	settings: RsvpWindowDates | null | undefined,
	now: Date = new Date()
): WalletIneligibility | null {
	if (user.status !== UserStatus.CONFIRMED && user.status !== UserStatus.CHECKED_IN) {
		return 'NOT_CONFIRMED';
	}
	if (!isRsvpClosed(settings, now)) return 'RSVP_STILL_OPEN';
	return null;
}

export function isWalletPassEligible(
	user: WalletPassSubject,
	settings: RsvpWindowDates | null | undefined,
	now: Date = new Date()
): boolean {
	return walletPassIneligibility(user, settings, now) === null;
}

/**
 * What to tell the person about their own account.
 *
 * Only ever shown to the account it describes. The RSVP message deliberately
 * doesn't name the date — the card that renders it has the deadline to hand and
 * formats it in the event's timezone, which a bare string here could not.
 */
export const WALLET_INELIGIBLE_MESSAGE: Record<WalletIneligibility, string> = {
	NOT_CONFIRMED: 'You must be a confirmed attendee to download a wallet pass.',
	RSVP_STILL_OPEN: 'Wallet passes unlock after the RSVP deadline.'
};
