import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';

export function createContext(event: RequestEvent) {
	void event;
	return { prisma };
}

export type Context = ReturnType<typeof createContext>;
