import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { homePathFor } from '$lib/auth/permissions';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		redirect(302, homePathFor(locals.user.roles));
	}
	return {};
};
