/**
 * The server-side wallet pass gate.
 *
 * ## Why this reads Settings itself
 *
 * The obvious implementation asks the settings router for the deadline. That is a
 * fail-open bug here, and a quiet one. `settings.get()` falls back to
 * `DEFAULT_SETTINGS` when no row exists, and that object's `RSVPDeadline` is
 * `new Date()` **evaluated at module load** — so on an install with no Settings
 * row it equals the moment the process booted, which is in the past for every
 * request after the first millisecond. `isRsvpClosed` would report the deadline
 * as passed, and this gate would hand a pass to every confirmed account in the
 * database on a freshly-seeded deployment.
 *
 * So: `findFirst()` directly, and `null` stays `null` all the way into
 * `walletPassIneligibility`, which treats absent settings as "not yet". The
 * account page's load function is already careful about this in the same way.
 *
 * The UI runs the same predicate to decide what to render, but the UI is the
 * explanation and this is the authority — the endpoints call it before signing
 * anything, so a hand-typed URL gets a 403 rather than a pass.
 */

import { error } from '@sveltejs/kit';
import type { PrismaClient, UserStatus } from '$lib/generated/prisma/client';
import {
	walletPassIneligibility,
	WALLET_INELIGIBLE_MESSAGE,
	type WalletIneligibility
} from '$lib/wallet/eligibility';

export type WalletGuardSubject = { status: UserStatus };

/** The RSVP deadline as stored, or `null` when the event has none configured yet. */
export async function rsvpDeadlineSettings(
	prisma: PrismaClient
): Promise<{ RSVPDeadline: Date } | null> {
	const settings = await prisma.settings.findFirst({ select: { RSVPDeadline: true } });
	return settings ?? null;
}

/** Why this account may not have a pass, or `null` when it may. */
export async function walletIneligibility(
	prisma: PrismaClient,
	user: WalletGuardSubject,
	now: Date = new Date()
): Promise<WalletIneligibility | null> {
	return walletPassIneligibility(user, await rsvpDeadlineSettings(prisma), now);
}

/**
 * Throw a 403 unless this account may download a pass.
 *
 * Used by the two `+server.ts` handlers, which are otherwise thin enough to have
 * no tested logic of their own.
 */
export async function assertWalletPassEligible(
	prisma: PrismaClient,
	user: WalletGuardSubject,
	now: Date = new Date()
): Promise<void> {
	const reason = await walletIneligibility(prisma, user, now);
	if (reason) error(403, WALLET_INELIGIBLE_MESSAGE[reason]);
}
