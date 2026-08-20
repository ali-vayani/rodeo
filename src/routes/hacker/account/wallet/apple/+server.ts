/**
 * The Apple Wallet download.
 *
 * A real HTTP response rather than a tRPC procedure, because the `Content-Type` is the
 * entire mechanism: `application/vnd.apple.pkpass` is what makes Mobile Safari open the
 * Add Pass sheet. Shipping the bytes through tRPC turned a 90 KB pass into a JSON array
 * of 90,000 integers, and the `blob:` handoff is the most common cause of "Safari
 * cannot download this file". It also means the pass is signed when someone asks.
 *
 * Kept thin: this repo has no `+server.ts` handler tests, so anything with a decision
 * in it lives in `$lib/server/wallet`.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applePassFilename, buildApplePass } from '$lib/server/wallet/apple';
import { assertWalletPassEligible } from '$lib/server/wallet/guard';
import { prisma } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals }) => {
	// `hooks.server.ts` has established who this is and that they may reach /hacker/*.
	// It has not established that they may have a pass.
	const user = locals.user;
	if (!user) error(401, 'Sign in to download your wallet pass.');

	await assertWalletPassEligible(prisma, user);

	const settings = await prisma.settings.findFirst({ select: { hackathonStartDate: true } });
	const group = user.groupId
		? await prisma.group.findUnique({ where: { id: user.groupId }, select: { name: true } })
		: null;

	const pass = await buildApplePass(
		{ uid: user.uid, name: user.name, group: group?.name ?? null },
		{ hackathonStartDate: settings?.hackathonStartDate }
	);

	// Null means Apple is unconfigured or its certificate has expired. The button is
	// already hidden in that state, so this is a hand-typed URL.
	if (!pass) error(503, 'Apple Wallet passes are not available on this deployment.');

	return new Response(new Uint8Array(pass), {
		headers: {
			'Content-Type': 'application/vnd.apple.pkpass',
			'Content-Disposition': `attachment; filename="${applePassFilename(user.uid)}"`,
			// The pass carries this hacker's check-in code. Nothing may hold a copy.
			'Cache-Control': 'private, no-store'
		}
	});
};
