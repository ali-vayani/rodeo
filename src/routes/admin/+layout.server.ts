import { Role } from '$lib/generated/prisma/enums';
import type { LayoutServerLoad } from './$types';

/**
 * The nav filters itself by role, so it needs to know the viewer's role. Access is
 * already enforced in hooks.server.ts — this only decides which links to draw.
 *
 * UNDECLARED is the fallback for a missing user because it grants nothing: the hook
 * has already redirected anyone without portal access, so this branch is unreachable,
 * and if that ever stops being true it should draw an empty nav rather than a full one.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	return { role: locals.user?.role ?? Role.UNDECLARED };
};
