import { z } from 'zod';
import type { Prisma } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';

/**
 * The one definition of "which users does this filter select".
 *
 * `user.list` (browse) and `email.sendCustom` / `email.previewRecipients` (send)
 * MUST share this. They previously disagreed on the empty-selection case in the
 * worst possible direction: the browse query matched nothing while the send query
 * dropped the clause and matched everyone, so a UI showing "0 recipients" from one
 * would mail the entire database via the other.
 */
export const recipientFilterSchema = z.object({
	search: z.string().optional(),
	roles: z.array(z.nativeEnum(Role)).optional(),
	statuses: z.array(z.nativeEnum(UserStatus)).optional(),
	decisions: z.array(z.nativeEnum(DecisionStatus)).optional(),
	includeNoDecision: z.boolean().optional(),
	/**
	 * Explicit recipient list. Present means "these addresses", intersected with any
	 * other filters supplied. An empty array means nobody — same "engaged but empty"
	 * rule the decision filter uses.
	 */
	emails: z.array(z.string()).optional()
});

export type RecipientFilters = z.infer<typeof recipientFilterSchema>;

// Email-list parsing lives in $lib/admin/filters.ts — it must be importable from
// the browser, and everything under $lib/server is barred from client bundles.

/**
 * Forces a match-nothing predicate. Used when the caller explicitly engaged the
 * decision filter but selected none of its options — "show nothing", not "show all".
 */
const MATCH_NOTHING = 'IMPOSSIBLE_NO_MATCH';

export function buildRecipientWhere(filters: RecipientFilters): Prisma.UserWhereInput {
	const { search, roles, statuses, decisions, includeNoDecision, emails } = filters;

	// AND conditions so each filter stacks independently.
	const conditions: Prisma.UserWhereInput[] = [];

	// Explicit address list. Engaged-but-empty means nobody, not everybody.
	// Lowercased to match stored addresses: accounts are written lowercase everywhere,
	// so a pasted `Alice@X.com` against a stored `alice@x.com` would otherwise silently
	// match nobody — and previewRecipients would report a real user as "unknown".
	if (emails !== undefined) {
		conditions.push(
			emails.length
				? { email: { in: emails.map((e) => e.trim().toLowerCase()) } }
				: { uid: MATCH_NOTHING }
		);
	}

	if (search) {
		conditions.push({
			OR: [
				{ name: { contains: search, mode: 'insensitive' as const } },
				{ email: { contains: search, mode: 'insensitive' as const } }
			]
		});
	}

	// `in`, not `hasSome`: `roles` is still a list here — it is the set of roles the
	// admin ticked in the filter — but each *user* now holds exactly one, so the
	// predicate is membership rather than array overlap.
	if (roles?.length) conditions.push({ role: { in: roles } });
	if (statuses?.length) conditions.push({ status: { in: statuses } });

	// Decision filter: specific decisions AND/OR null (no decision yet).
	// Note this reads activeDecision — never pendingDecision, which is unreleased.
	if (decisions !== undefined || includeNoDecision !== undefined) {
		const decisionOr: Prisma.UserWhereInput[] = [];
		if (decisions?.length) decisionOr.push({ activeDecision: { in: decisions } });
		if (includeNoDecision) decisionOr.push({ activeDecision: null });

		if (decisionOr.length === 1) conditions.push(decisionOr[0]);
		else if (decisionOr.length > 1) conditions.push({ OR: decisionOr });
		// Engaged the filter but selected nothing → match nothing.
		else conditions.push({ uid: MATCH_NOTHING });
	}

	// No filter keys supplied at all → match everyone. This is the "email the whole
	// database" case, so callers that send must gate on the resulting count.
	return conditions.length > 0 ? { AND: conditions } : {};
}
