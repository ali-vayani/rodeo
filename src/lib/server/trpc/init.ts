import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { Role } from '$lib/generated/prisma/client';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.ORGANIZER];

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!ctx.user.roles.some((r) => ADMIN_ROLES.includes(r))) {
		throw new TRPCError({ code: 'FORBIDDEN' });
	}
	return next({ ctx: { ...ctx, user: ctx.user } });
});

export const createCallerFactory = t.createCallerFactory;
