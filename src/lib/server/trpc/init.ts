import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { isAdmin, hasPortalAccess } from '$lib/auth/permissions';
import type { Context } from './context';

/**
 * Makes an input-validation failure readable.
 *
 * tRPC turns a thrown `ZodError` into a BAD_REQUEST whose `message` is the raw
 * issue array serialized as JSON, and every catch block in the UI renders
 * `error.message` directly. A hacker mistyping their teammate's address got a wall
 * of `[{"origin":"string","code":"invalid_format",...}]` where a sentence belonged.
 * Replacing the message with the issues' own text means a procedure that spells one
 * out — `.email('Enter a valid email address.')` — has it show up verbatim, with no
 * per-call-site unwrapping.
 *
 * `data.zodError` keeps the field-keyed breakdown for any form that would rather
 * mark up individual inputs than print one line.
 *
 * Exported for its own test: `createCallerFactory` bypasses the formatter, so the
 * router tests can't reach it and it would otherwise be covered nowhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC's shape type is internal and not exported.
export function formatTRPCError({ shape, error }: { shape: any; error: { cause?: unknown } }) {
	if (!(error.cause instanceof ZodError)) return shape;

	const message = error.cause.issues.map((issue) => issue.message).join(' ');
	return {
		...shape,
		message: message || shape.message,
		data: { ...shape.data, zodError: error.cause.flatten().fieldErrors }
	};
}

const t = initTRPC.context<Context>().create({
	transformer: superjson,
	errorFormatter: formatTRPCError
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * ADMIN only — the default for anything touching user data.
 *
 * Deliberately the stricter of the two: an endpoint an organizer should reach has to
 * opt in to `portalProcedure` below. A call site nobody thought about therefore denies
 * rather than leaks, which is the only safe direction for a permission split.
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!isAdmin(ctx.user.roles)) throw new TRPCError({ code: 'FORBIDDEN' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * ADMIN or ORGANIZER — the shared admin-portal surface.
 *
 * Only for endpoints that expose no per-person data: scanning, the schedule, and the
 * dashboard's anonymous aggregates. See $lib/auth/permissions for the full split.
 */
export const portalProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!hasPortalAccess(ctx.user.roles)) throw new TRPCError({ code: 'FORBIDDEN' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

export const createCallerFactory = t.createCallerFactory;
