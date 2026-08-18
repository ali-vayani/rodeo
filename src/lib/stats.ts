/**
 * Shapes for the per-admin activity stats.
 *
 * Isomorphic on purpose: `$lib/server/trpc/routers/stats` builds these and
 * `AdminStatsChart` renders them. Living outside `$lib/server` is what lets the
 * component name the type without importing a server-only module.
 *
 * Keep it free of Prisma, `$env`, and node builtins.
 */

import type { Role } from '$lib/generated/prisma/enums';

export interface AdminStats {
	uid: string;
	name: string;
	role: Role;
	accepted: number;
	rejected: number;
	waitlisted: number;
	/** accepted + rejected + waitlisted — what the ranking sorts on. */
	decisions: number;
	/** Times this admin pressed send, regardless of audience size. */
	emailCampaigns: number;
	/** Messages actually delivered — attempted minus the ones that bounced. */
	emailRecipients: number;
	scans: number;
}

/**
 * Decisions with no admin behind them: history from before attribution existed,
 * and the blacklist auto-reject in `application.submit`. Reported rather than
 * dropped so the per-admin bars sum to the real decision totals.
 */
export interface UnattributedStats {
	accepted: number;
	rejected: number;
	waitlisted: number;
	total: number;
}
