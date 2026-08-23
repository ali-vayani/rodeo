import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { isAdmin, hasPortalAccess } from '$lib/auth/permissions';
import type { Context } from './context';

/**
 * Replaces tRPC's default BAD_REQUEST message, the raw zod issue array as JSON, with the
 * issues' own text. The UI renders `error.message` verbatim.
 *
 * Inputs:
 * - shape: tRPC error shape — the default formatted error
 * - error: { cause?: unknown } — only a `ZodError` cause is rewritten
 *
 * Outputs:
 * - shape — `message` is the joined issue text and `data.zodError` the field-keyed
 *   breakdown; non-zod errors pass through untouched
 *
 * Exported for its own test: `createCallerFactory` bypasses the formatter.
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
 * ADMIN only. The default for anything touching user data, so a call site nobody
 * thought about denies rather than leaks.
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!isAdmin(ctx.user.role)) throw new TRPCError({ code: 'FORBIDDEN' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * ADMIN or ORGANIZER. Only for endpoints that expose no per-person data: scanning, the
 * schedule, and the dashboard's anonymous aggregates. See $lib/auth/permissions.
 */
export const portalProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!hasPortalAccess(ctx.user.role)) throw new TRPCError({ code: 'FORBIDDEN' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

export const createCallerFactory = t.createCallerFactory;
