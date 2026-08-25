// The enums module, not the client barrel: this file is imported by a Svelte component
// as well as by the server, and the barrel drags in the Node-only Prisma runtime.
import { UserStatus } from '$lib/generated/prisma/enums';
import { toDate } from '$lib/application/window';

/**
 * Who may download a wallet pass: someone actually coming (CONFIRMED, or CHECKED_IN
 * for anyone who lost their pass on the day), once the attendee list has stopped
 * moving — the RSVP deadline when one is set, the event start when there is none.
 *
 * The date check runs backwards from the application form, where an unconfigured
 * window reads as open. This gate wants a passed unlock date, so a missing Settings
 * row and an unparseable date both come out ineligible. `eligibility.test.ts` pins
 * those cases by name; if either fails, fix the gate, not the test.
 *
 * Callers must not source `settings` from `settings.get()`, whose `DEFAULT_SETTINGS`
 * fallback puts `hackathonStartDate` at module load time. Read
 * `prisma.settings.findFirst()` and pass `null` through unchanged.
 */
export type WalletPassSubject = {
	status: UserStatus;
};

/** The two columns the unlock date is derived from. */
export type WalletUnlockDates = {
	RSVPDeadline: Date | string | null;
	hackathonStartDate: Date | string;
};

/** When passes unlock: the RSVP deadline, or the event start when none is set. */
export function walletUnlockDate(settings: WalletUnlockDates | null | undefined): Date | null {
	if (!settings) return null;
	return toDate(settings.RSVPDeadline) ?? toDate(settings.hackathonStartDate);
}

/** Strict `>`, matching `isRsvpClosed`, so the pass and the RSVP button agree at the boundary. */
export function isWalletUnlocked(
	settings: WalletUnlockDates | null | undefined,
	now: Date = new Date()
): boolean {
	const unlock = walletUnlockDate(settings);
	return unlock != null && now > unlock;
}

/** Why an account may not have a wallet pass, or `null` when it may. */
export type WalletIneligibility = 'NOT_CONFIRMED' | 'RSVP_STILL_OPEN';

export function walletPassIneligibility(
	user: WalletPassSubject,
	settings: WalletUnlockDates | null | undefined,
	now: Date = new Date()
): WalletIneligibility | null {
	if (user.status !== UserStatus.CONFIRMED && user.status !== UserStatus.CHECKED_IN) {
		return 'NOT_CONFIRMED';
	}
	if (!isWalletUnlocked(settings, now)) return 'RSVP_STILL_OPEN';
	return null;
}

export function isWalletPassEligible(
	user: WalletPassSubject,
	settings: WalletUnlockDates | null | undefined,
	now: Date = new Date()
): boolean {
	return walletPassIneligibility(user, settings, now) === null;
}

/**
 * What to tell the person about their own account. The unlock message does not name a
 * date; the card that renders it formats the unlock date in the event's timezone.
 */
export const WALLET_INELIGIBLE_MESSAGE: Record<WalletIneligibility, string> = {
	NOT_CONFIRMED: 'You must be a confirmed attendee to download a wallet pass.',
	RSVP_STILL_OPEN: 'Wallet passes unlock once the attendee list is final.'
};
