/**
 * Writing to the audit trail.
 *
 * Every admin mutation ends with a `logAction` call. The rule for a good entry:
 *
 *   - `action` is the stable slug the logs page filters on (see `$lib/log/actions`).
 *   - `summary` is a sentence **starting with the verb** — the dashboard feed and
 *     the logs table both render it as "{actor} {summary}", so "Accepted Sarah
 *     Chen" reads correctly where "Ali accepted Sarah Chen" would stutter.
 *   - `target` names the row acted on, so history survives that row's deletion.
 *   - `metadata` is the before/after detail nobody wants in the sentence.
 */

import type { Prisma, PrismaClient } from '$lib/generated/prisma/client';
import type { LogAction } from '$lib/log/actions';

/**
 * Structural rather than `PrismaClient`, so a caller inside `$transaction` can
 * pass the transaction client and have the audit row roll back with the change
 * it describes.
 */
export interface LogWriter {
	log: PrismaClient['log'];
}

/**
 * The subset of the tRPC context this needs. `user` is nullable because the type
 * is shared with `authedProcedure`; under `adminProcedure` it is always set.
 */
export interface LogContext {
	prisma: LogWriter;
	user: { uid: string; name: string; email: string } | null;
}

/** Values allowed in `metadata`. Deliberately flat — this is display-only detail. */
export type LogMetadata = Record<string, string | number | boolean | string[] | null | undefined>;

export interface LogInput {
	action: LogAction;
	/** Verb-first sentence, rendered after the actor's name. */
	summary: string;
	/** The row acted on. `label` is snapshotted so it outlives that row. */
	target?: { id?: string | null; label?: string | null };
	metadata?: LogMetadata;
}

/**
 * Append one entry to the audit trail.
 *
 * Failures are swallowed with a stderr warning rather than thrown. An audit write
 * is a side effect of the real work: if the Log insert fails after decisions have
 * already been released and emails sent, surfacing that as a failed mutation would
 * invite the admin to retry a batch that has already gone out. A missing row is the
 * lesser harm, and the stderr line is what makes it findable.
 */
export async function logAction(ctx: LogContext, input: LogInput): Promise<void> {
	try {
		await ctx.prisma.log.create({
			data: {
				action: input.action,
				summary: input.summary,
				actorId: ctx.user?.uid ?? null,
				// Snapshotted beside the FK: `onDelete: SetNull` would otherwise erase
				// who did this the moment the organizer's account is removed.
				actorName: ctx.user?.name ?? null,
				actorEmail: ctx.user?.email ?? null,
				targetId: input.target?.id ?? null,
				targetLabel: input.target?.label ?? null,
				metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined
			}
		});
	} catch (error) {
		console.error(`[audit] failed to record "${input.action}": ${input.summary}`, error);
	}
}

/** Formats a list for a summary sentence: empty → "none", else comma-joined. */
export function listOrNone(values: readonly string[]): string {
	return values.length > 0 ? values.join(', ') : 'none';
}

/** Formats a nullable enum for a summary or metadata value. */
export function valueOrNone(value: string | null | undefined): string {
	return value ?? 'none';
}
