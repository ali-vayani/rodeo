import type { LayoutServerLoad } from './$types';

/**
 * The nav filters itself by role, so it needs to know the viewer's roles. Access is
 * already enforced in hooks.server.ts — this only decides which links to draw.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	return { roles: locals.user?.roles ?? [] };
};
