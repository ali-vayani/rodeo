import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { Role } from '$lib/generated/prisma/client';

const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.ORGANIZER];

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		const isAdmin = locals.user.roles.some((r) => ADMIN_ROLES.includes(r));
		redirect(302, isAdmin ? '/admin/dashboard' : '/hacker/application');
	}
	return {};
};
