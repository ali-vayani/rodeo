import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = locals.user!;
	return {
		me: {
			name: user.name,
			email: user.email,
			role: user.role,
			createdAt: user.createdAt
		}
	};
};
