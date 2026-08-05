import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPortalAccess } from '$lib/auth/permissions';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		redirect(302, hasPortalAccess(locals.user.roles) ? '/admin/dashboard' : '/hacker/application');
	}
	return {};
};
