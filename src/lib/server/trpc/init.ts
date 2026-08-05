import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { isAdmin, hasPortalAccess } from '$lib/auth/permissions';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({ transformer: superjson });

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
