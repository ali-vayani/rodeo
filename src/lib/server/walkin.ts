import { appOrigin } from '$lib/server/env';

/**
 * The absolute URL `{{walkin_link}}` substitutes to. Deliberately credential-free,
 * same as the wallet links: a signed-out click bounces through `/login?redirectTo=...`,
 * and the page itself only unlocks for an account whose email was invited.
 */
export function walkInUrl(): string {
	return `${appOrigin()}/hacker/walkin`;
}
