import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '$lib/server/trpc/router';

/** Browser/client-side tRPC caller (relative URL works with the SvelteKit dev server and same-origin deploys). */
export function createClient() {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: '/api/trpc',
				transformer: superjson
			})
		]
	});
}
