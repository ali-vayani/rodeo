import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	return {
		adminUid: event.locals.user?.uid ?? '',
		adminName: event.locals.user?.name ?? 'You'
	};
};
