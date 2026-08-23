import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { buildExport, wipeDatabase } from '$lib/server/data';
import { dataPasswordConfigured, verifyDataPassword } from '$lib/server/env';

/** Shared by both inputs so the two can't drift on what a password looks like. */
const passwordInput = { password: z.string().min(1) };

/**
 * Rejects unless `ADMIN_DATA_PASSWORD` is set and matches.
 *
 * Inputs:
 * - password: string — the submitted password; never echoed back
 *
 * Throws:
 * - TRPCError PRECONDITION_FAILED — the env var is unset (an operator problem)
 * - TRPCError UNAUTHORIZED — wrong password. Not FORBIDDEN, which `adminProcedure`
 *   uses for "your account may not do this at all"
 */
function requirePassword(password: string) {
	if (!dataPasswordConfigured()) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message:
				'ADMIN_DATA_PASSWORD is not set on this deploy, so exporting and wiping are disabled. ' +
				'Set it in the environment to enable them.'
		});
	}
	if (!verifyDataPassword(password)) {
		throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect password.' });
	}
}

export const dataRouter = router({
	/**
	 * Every table, as a JSON string ready to be written to a file.
	 *
	 * A mutation despite only reading: tRPC puts query input in the URL, which would
	 * write the password into browser history and proxy logs.
	 */
	exportAll: adminProcedure
		.input(z.object({ ...passwordInput }))
		.mutation(async ({ ctx, input }) => {
			requirePassword(input.password);

			const data = await buildExport(ctx.prisma);

			await logAction(ctx, {
				action: 'data.export',
				summary: `Exported the full database (${data.counts.user} users across ${Object.keys(data.tables).length} tables)`,
				metadata: data.counts
			});

			return { json: JSON.stringify(data, null, 2), counts: data.counts };
		}),

	/**
	 * Empties the database, keeping staff accounts and the blacklist.
	 *
	 * Does not build its own export: the caller exports and writes the file first, so a
	 * copy exists before anything is destroyed. The audit entry is written afterwards
	 * because `Log` is one of the tables emptied.
	 */
	wipe: adminProcedure
		.input(
			z.object({
				...passwordInput,
				// The password proves authority; this proves intent.
				confirm: z.literal('WIPE')
			})
		)
		.mutation(async ({ ctx, input }) => {
			requirePassword(input.password);

			const deleted = await wipeDatabase(ctx.prisma);

			await logAction(ctx, {
				action: 'data.wipe',
				summary:
					`Wiped the database — removed ${deleted.user} users, ` +
					`${deleted.applicationResponse} application responses and ${deleted.log} log entries. ` +
					'Staff accounts and the blacklist were kept.',
				metadata: deleted
			});

			return deleted;
		})
});
