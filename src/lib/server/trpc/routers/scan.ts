import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, portalProcedure } from '../init';
import { logAction } from '$lib/server/log';
import { Role, UserStatus, type PrismaClient } from '$lib/generated/prisma/client';

/**
 * The projection every endpoint here hands back in place of a `User` row.
 *
 * Organizers may work the scan page (`ORGANIZER_SECTIONS` in src/lib/auth/permissions.ts)
 * but are explicitly not to see per-person data, and a full row carries phone-book
 * detail plus `pendingDecision`/`activeDecision` — i.e. who was rejected. These are
 * exactly the fields the scan UI consumes: `ScanConfirmDialog`'s `DialogUser` prop,
 * plus `uid`, which the page sends back to `scanUser` on confirm.
 */
const scanUserSelect = {
	uid: true,
	name: true,
	email: true,
	university: true,
	year: true,
	role: true,
	status: true
} as const;

/**
 * Scans and history are the event's own record, not the attendee's — no user row
 * hangs off them beyond the name the recent-scans list prints.
 */
const scanSelect = { id: true, action: true, timestamp: true } as const;

/**
 * A scanned QR code carries the whole uid, but a human typing from the printed
 * badge has only the `RC-` + last four (see `QRCard.svelte`), and that tail is
 * matched as a uid *suffix*. Anything shorter stops identifying one person: `RC-`
 * on its own strips to `''`, which is `uid LIKE '%'` — every user in the table.
 */
const MIN_CODE_SUFFIX_LENGTH = 4;

/** The scan actions in force. Falls back to the default so a fresh install fails closed. */
function allowedActions(settings: { scanActions: string[] } | null): string[] {
	return settings?.scanActions?.length ? settings.scanActions : ['Check-In'];
}

/**
 * The action that means "arrived at the event" and promotes CONFIRMED → CHECKED_IN.
 * By convention the first configured action; `Check-In` on a fresh install.
 */
function checkInAction(settings: { scanActions: string[] } | null): string {
	return allowedActions(settings)[0];
}

function assertActionAllowed(settings: { scanActions: string[] } | null, action: string): void {
	// Fail closed before a Settings row exists: without this, any string was accepted
	// and persisted as a scan action.
	if (!allowedActions(settings).includes(action)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid scan action "${action}". Valid actions: ${allowedActions(settings).join(', ')}`
		});
	}
}

async function assertValidAction(prisma: PrismaClient, action: string): Promise<void> {
	assertActionAllowed(await prisma.settings.findFirst(), action);
}

async function resolveUserByCode(prisma: PrismaClient, userCode: string) {
	const code = userCode.trim();
	const suffix = code.replace(/^RC-/i, '');
	if (suffix.length < MIN_CODE_SUFFIX_LENGTH) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Scan code is too short — expected at least ${MIN_CODE_SUFFIX_LENGTH} characters after "RC-".`
		});
	}

	// `take: 2` is all it costs to tell "one match" from "more than one": a suffix is
	// not a unique key, so silently taking the first row checks in the wrong person and
	// audit-logs it under their name. Two rows means the volunteer has to disambiguate.
	// Case-insensitive on the suffix because the badge prints it uppercased
	// (`QRCard.svelte`) while a cuid is lowercase — a hand-typed `RC-AB12` would
	// otherwise never match the `ab12` actually stored.
	const users = await prisma.user.findMany({
		where: { OR: [{ uid: code }, { uid: { endsWith: suffix, mode: 'insensitive' } }] },
		select: scanUserSelect,
		take: 2
	});

	if (users.length === 0) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
	}
	if (users.length > 1) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'That code matches more than one attendee — look them up by email instead.'
		});
	}
	return users[0];
}

async function resolveUserByEmail(prisma: PrismaClient, email: string) {
	const user = await prisma.user.findUnique({
		where: { email: email.trim().toLowerCase() },
		select: scanUserSelect
	});
	if (!user) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
	}
	return user;
}

async function isDuplicateToday(
	prisma: PrismaClient,
	userId: string,
	action: string
): Promise<boolean> {
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);

	const duplicate = await prisma.scan.findFirst({
		where: { userId, action, timestamp: { gte: startOfDay } }
	});

	return !!duplicate;
}

export const scanRouter = router({
	lookup: portalProcedure
		.input(
			z.object({
				userCode: z.string().min(1),
				action: z.string().min(1)
			})
		)
		.query(async ({ ctx, input }) => {
			await assertValidAction(ctx.prisma, input.action);
			const user = await resolveUserByCode(ctx.prisma, input.userCode);

			const [isDuplicate, scanCountForAction] = await Promise.all([
				isDuplicateToday(ctx.prisma, user.uid, input.action),
				ctx.prisma.scan.count({ where: { userId: user.uid, action: input.action } })
			]);

			const isUnconfirmedHacker =
				user.role === Role.HACKER &&
				user.status !== UserStatus.CONFIRMED &&
				user.status !== UserStatus.CHECKED_IN;

			return {
				user,
				isDuplicate,
				scanCountForAction,
				warning: isUnconfirmedHacker ? ('UNCONFIRMED_HACKER' as const) : null
			};
		}),

	lookupByEmail: portalProcedure
		.input(
			z.object({
				email: z.string().min(1),
				action: z.string().min(1)
			})
		)
		.query(async ({ ctx, input }) => {
			await assertValidAction(ctx.prisma, input.action);
			const user = await resolveUserByEmail(ctx.prisma, input.email);

			const [isDuplicate, scanCountForAction] = await Promise.all([
				isDuplicateToday(ctx.prisma, user.uid, input.action),
				ctx.prisma.scan.count({ where: { userId: user.uid, action: input.action } })
			]);

			const isUnconfirmedHacker =
				user.role === Role.HACKER &&
				user.status !== UserStatus.CONFIRMED &&
				user.status !== UserStatus.CHECKED_IN;

			return {
				user,
				isDuplicate,
				scanCountForAction,
				warning: isUnconfirmedHacker ? ('UNCONFIRMED_HACKER' as const) : null
			};
		}),

	getCounts: portalProcedure.query(async ({ ctx }) => {
		const [settings, grouped] = await Promise.all([
			ctx.prisma.settings.findFirst(),
			ctx.prisma.scan.groupBy({ by: ['action'], _count: { action: true } })
		]);
		const actions = settings?.scanActions ?? ['Check-In'];

		const counts: Record<string, number> = {};
		for (const action of actions) counts[action] = 0;
		// Also surfaces retired actions with historical scans that are no longer in settings — intentional.
		for (const row of grouped) counts[row.action] = row._count.action;

		return counts;
	}),

	scanUser: portalProcedure
		.input(
			z.object({
				userCode: z.string().min(1),
				action: z.string().min(1)
			})
		)
		.mutation(async ({ ctx, input }) => {
			// The write path runs the same helpers as `lookup` on purpose: it used to carry
			// its own copy of the action check and the code lookup, which meant a fix to one
			// left the other resolving codes the old way.
			const settings = await ctx.prisma.settings.findFirst();
			assertActionAllowed(settings, input.action);
			const user = await resolveUserByCode(ctx.prisma, input.userCode);
			const isDuplicate = await isDuplicateToday(ctx.prisma, user.uid, input.action);

			// Checking in is what actually moves a CONFIRMED attendee to CHECKED_IN — nothing
			// else in the app writes that status, so without this the check-in count, the
			// hacker "checked in" view, and joinByCode's CHECKED_IN allowance were all dead.
			// The scan row and the status change commit together so a recorded check-in can't
			// exist without the status, or vice versa.
			const promotesToCheckedIn =
				input.action === checkInAction(settings) && user.status === UserStatus.CONFIRMED;

			const scan = await ctx.prisma.$transaction(async (tx) => {
				const created = await tx.scan.create({
					data: { userId: user.uid, action: input.action },
					select: scanSelect
				});
				if (promotesToCheckedIn) {
					await tx.user.update({
						where: { uid: user.uid },
						data: { status: UserStatus.CHECKED_IN }
					});
				}
				return created;
			});

			const resultUser = promotesToCheckedIn ? { ...user, status: UserStatus.CHECKED_IN } : user;

			await logAction(ctx, {
				action: 'scan.record',
				summary: isDuplicate
					? `Scanned ${user.name} for "${input.action}" (already scanned today)`
					: `Scanned ${user.name} for "${input.action}"`,
				target: { id: user.uid, label: user.name },
				metadata: {
					scanAction: input.action,
					duplicate: isDuplicate,
					scanId: scan.id,
					checkedIn: promotesToCheckedIn
				}
			});

			return { scan, user: resultUser, isDuplicate };
		}),

	getRecent: portalProcedure
		.input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
		.query(async ({ ctx, input }) => {
			return ctx.prisma.scan.findMany({
				take: input.limit,
				orderBy: { timestamp: 'desc' },
				select: { ...scanSelect, user: { select: { name: true } } }
			});
		}),

	getHistory: portalProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			// Takes an arbitrary uid, so it deliberately returns nothing about the person
			// it belongs to — only that user's scan trail.
			return ctx.prisma.scan.findMany({
				where: { userId: input.userId },
				orderBy: { timestamp: 'desc' },
				select: scanSelect
			});
		})
});
