import { Role } from '$lib/generated/prisma/enums';
import type { LayoutServerLoad } from './$types';

/**
 * The nav filters itself by role, so it needs the viewer's role. Access is already
 * enforced in hooks.server.ts; this only decides which links to draw.
 *
 * UNDECLARED is the fallback for a missing user because it grants nothing.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	return { role: locals.user?.role ?? Role.UNDECLARED };
};
