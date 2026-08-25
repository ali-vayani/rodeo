/**
 * The server-side wallet pass gate, and the authority the UI only explains.
 *
 * Reads Settings itself rather than asking the settings router, which is a fail-open
 * bug here: `settings.get()` falls back to `DEFAULT_SETTINGS`, whose
 * `hackathonStartDate` is module load time and therefore always past. This gate would
 * then hand a pass to every confirmed account. So `findFirst()` directly, and `null`
 * stays `null` all the way into `walletPassIneligibility`, which treats absent
 * settings as "not yet".
 */

import { error } from '@sveltejs/kit';
import type { PrismaClient, UserStatus } from '$lib/generated/prisma/client';
import {
	walletPassIneligibility,
	WALLET_INELIGIBLE_MESSAGE,
	type WalletIneligibility
} from '$lib/wallet/eligibility';

export type WalletGuardSubject = { status: UserStatus };

/** The unlock columns as stored, or `null` when the event isn't configured yet. */
export async function walletUnlockSettings(
	prisma: PrismaClient
): Promise<{ RSVPDeadline: Date | null; hackathonStartDate: Date } | null> {
	const settings = await prisma.settings.findFirst({
		select: { RSVPDeadline: true, hackathonStartDate: true }
	});
	return settings ?? null;
}

/** Why this account may not have a pass, or `null` when it may. */
export async function walletIneligibility(
	prisma: PrismaClient,
	user: WalletGuardSubject,
	now: Date = new Date()
): Promise<WalletIneligibility | null> {
	return walletPassIneligibility(user, await walletUnlockSettings(prisma), now);
}

/** Throw a 403 unless this account may download a pass. Used by the two `+server.ts`
    handlers, which have no tested logic of their own. */
export async function assertWalletPassEligible(
	prisma: PrismaClient,
	user: WalletGuardSubject,
	now: Date = new Date()
): Promise<void> {
	const reason = await walletIneligibility(prisma, user, now);
	if (reason) error(403, WALLET_INELIGIBLE_MESSAGE[reason]);
}
