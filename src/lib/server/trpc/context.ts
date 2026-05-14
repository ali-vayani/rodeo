import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';

export function createContext(event: RequestEvent) {
	return { prisma, user: event.locals.user };
}

export type Context = ReturnType<typeof createContext>;
