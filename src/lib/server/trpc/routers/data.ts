import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { buildExport, wipeDatabase } from '$lib/server/data';
import { dataPasswordConfigured, verifyDataPassword } from '$lib/server/env';

/**
 * The password every procedure here demands, on top of being an admin.
 *
 * Declared once and spread into both inputs so the two can never drift into
 * different rules about what a submitted password looks like.
 */
const passwordInput = { password: z.string().min(1) };

/**
 * Reject unless `ADMIN_DATA_PASSWORD` is set and matches.
 *
 * The three failures are told apart on purpose. "Not configured" is an operator
 * problem — the deploy is missing a variable, and saying so is what stops
 * someone concluding their password is wrong and trying variations.
 *
 * A wrong password is UNAUTHORIZED, never FORBIDDEN. FORBIDDEN is what
 * `adminProcedure` returns for "your account may not do this at all", and the
 * two must stay distinguishable: an organizer and an admin who fat-fingered the
 * password have entirely different problems, and collapsing both into one code
 * means neither the UI nor the permission tests can tell which gate rejected the
 * call. The message says only that the password was wrong — never echoing what
 * was submitted, nor hinting at its length.
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
	 * A mutation rather than a query even though it only reads: tRPC puts query
	 * input in the request URL, which would write the password into browser
	 * history, proxy logs and any error reporter in the path. It also writes an
	 * audit entry, which queries are not supposed to do.
	 *
	 * Serialised here rather than in the browser so the client never has to
	 * reassemble the object — and so the bytes that land in the file are the
	 * bytes the server produced.
	 */
	exportAll: adminProcedure
		.input(z.object({ ...passwordInput }))
		.mutation(async ({ ctx, input }) => {
			requirePassword(input.password);

			const data = await buildExport(ctx.prisma);

			// The single most sensitive read in the app: one file with every
			// applicant's name, email and answers. "Who took a copy, and when" is
			// exactly what an audit trail is for.
			await logAction(ctx, {
				action: 'data.export',
				summary: `Exported the full database (${data.counts.user} users across ${Object.keys(data.tables).length} tables)`,
				metadata: data.counts
			});

			return { json: JSON.stringify(data, null, 2), counts: data.counts };
		}),

	/**
	 * Empty the database, keeping staff accounts and the blacklist.
	 *
	 * Deliberately does NOT build its own export. The caller exports first and
	 * writes the file to disk, then calls this — so the copy exists before
	 * anything is destroyed. Doing both server-side in one call would put the
	 * only copy of the data in an HTTP response body that is sent *after* the
	 * delete, where a dropped connection loses it for good.
	 *
	 * The audit entry is written after the delete, not before: `Log` is one of
	 * the tables emptied, so an entry written first would erase itself. Writing
	 * it afterwards leaves the wipe as the first row of the new trail.
	 */
	wipe: adminProcedure
		.input(
			z.object({
				...passwordInput,
				// A second, different thing to get right. The password proves
				// authority; this proves intent.
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
