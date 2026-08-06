/**
 * The Google Wallet handoff.
 *
 * Google's save flow is a URL, not a file, so this is a redirect. Making it an
 * endpoint rather than a tRPC call is what lets the card render both providers as
 * plain `<a href>` elements — no client, no loading state, no error handling in
 * the component — and puts both behind the same eligibility check.
 *
 * The save link is minted per request rather than embedded in the page, because it
 * is a bearer token for this hacker's pass: it should not sit in the HTML of a page
 * that might be screenshotted, cached, or viewed over someone's shoulder.
 *
 * Kept thin on purpose: this repo has no `+server.ts` handler tests, so everything
 * with a decision in it lives in `$lib/server/wallet` where it is covered.
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildGoogleSaveUrl } from '$lib/server/wallet/google';
import { assertWalletPassEligible } from '$lib/server/wallet/guard';
import { prisma } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Sign in to add your wallet pass.');

	await assertWalletPassEligible(prisma, user);

	const group = user.groupId
		? await prisma.group.findUnique({ where: { id: user.groupId }, select: { name: true } })
		: null;

	let saveUrl: string | null;
	try {
		saveUrl = await buildGoogleSaveUrl({
			uid: user.uid,
			name: user.name,
			group: group?.name ?? null
		});
	} catch (cause) {
		// Google was configured but refused us — a revoked key, an issuer that lost
		// the Wallet Object Issuer role, an outage. Say so rather than redirecting to
		// a page that renders its own generic failure.
		error(502, `Google Wallet could not issue this pass: ${(cause as Error).message}`);
	}

	// Null means Google is unconfigured. The button is already hidden in that state,
	// so this is a hand-typed URL.
	if (!saveUrl) error(503, 'Google Wallet passes are not available on this deployment.');

	redirect(303, saveUrl);
};
