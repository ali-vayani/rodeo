import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { appleWalletConfigured, googleWalletConfigured } from '$lib/server/wallet/config';
import { provisionGoogleWalletClass } from '$lib/server/wallet/google';
import { walletIneligibility } from '$lib/server/wallet/guard';
import type { WalletIneligibility } from '$lib/wallet/eligibility';

export type WalletAvailability = {
	/** Whether each provider is configured *and* this caller may use it right now. */
	apple: boolean;
	google: boolean;
	/**
	 * Whether this deployment has any wallet credentials at all.
	 *
	 * Separate from the two booleans above because they collapse two different
	 * situations into `false`: "this event does not do wallet passes" and "yours is
	 * not ready yet". The card renders nothing for the first and an explanation for
	 * the second.
	 */
	configured: boolean;
	/** Why no pass is on offer, when the deployment does have credentials. */
	reason: WalletIneligibility | null;
};

export const walletRouter = router({
	/**
	 * What the account page should render.
	 *
	 * Combines "is the provider configured" with "may this caller have a pass", so the
	 * page never draws a button whose endpoint would answer 403. The reason comes back
	 * separately so a confirmed hacker waiting on the RSVP deadline is told when passes
	 * unlock, rather than being shown nothing and reporting it as a bug.
	 */
	availability: authedProcedure.query(async ({ ctx }): Promise<WalletAvailability> => {
		const reason = await walletIneligibility(ctx.prisma, ctx.user);
		const eligible = reason === null;
		const apple = appleWalletConfigured();
		const google = googleWalletConfigured();

		return {
			apple: eligible && apple,
			google: eligible && google,
			configured: apple || google,
			reason
		};
	}),

	/**
	 * Rewrite the Google Wallet class definition.
	 *
	 * Pass generation only ever creates the class, so artwork and layout changes need this
	 * explicit action. Otherwise a deploy would restyle every pass already in a phone.
	 */
	provisionGoogleClass: adminProcedure.mutation(async ({ ctx }) => {
		if (!googleWalletConfigured()) {
			throw new TRPCError({
				code: 'PRECONDITION_FAILED',
				message: 'Google Wallet is not configured on this deployment.'
			});
		}

		let classId: string;
		try {
			classId = await provisionGoogleWalletClass();
		} catch (cause) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: `Google Wallet class provisioning failed: ${(cause as Error).message}`,
				cause
			});
		}

		await logAction(ctx, {
			action: 'wallet.provisionGoogleClass',
			summary: `Re-provisioned the Google Wallet pass class ${classId}`,
			target: { id: classId, label: classId }
		});

		return { classId };
	})
});
