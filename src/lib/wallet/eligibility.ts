// The enums module, not the client barrel: this file is imported by a Svelte component
// as well as by the server, and the barrel drags in the Node-only Prisma runtime.
import { UserStatus } from '$lib/generated/prisma/enums';
import { isRsvpClosed, type RsvpWindowDates } from '$lib/application/window';

/**
 * Who may download a wallet pass: someone actually coming (CONFIRMED, or CHECKED_IN
 * for anyone who lost their pass on the day), once the RSVP deadline has passed so the
 * attendee list has stopped moving.
 *
 * The deadline check runs backwards from the application form. `isRsvpClosed` returns
 * `false` for a missing Settings row and for an unparseable date, which `window.ts`
 * documents as "unconfigured reads as open". This gate wants `true`, so those cases
 * come out ineligible, which is right but is arithmetic rather than agreement.
 * `eligibility.test.ts` pins both by name; if either fails, fix the gate, not the test.
 *
 * Callers must not source `settings` from `settings.get()`, whose `DEFAULT_SETTINGS`
 * fallback puts `RSVPDeadline` at module load time. Read `prisma.settings.findFirst()`
 * and pass `null` through unchanged.
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
 * What to tell the person about their own account. The RSVP message does not name the
 * date; the card that renders it formats the deadline in the event's timezone.
 */
export const WALLET_INELIGIBLE_MESSAGE: Record<WalletIneligibility, string> = {
	NOT_CONFIRMED: 'You must be a confirmed attendee to download a wallet pass.',
	RSVP_STILL_OPEN: 'Wallet passes unlock after the RSVP deadline.'
};
