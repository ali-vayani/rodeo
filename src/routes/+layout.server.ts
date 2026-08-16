import type { LayoutServerLoad } from './$types';
import { devSwitcherEnabled } from '$lib/server/env';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		// Whether to mount the account switcher. `dev` alone can't decide this in
		// the layout: it is a build-time constant that is false in every built
		// bundle, and preview deploys are built bundles that DO get the switcher.
		devSwitcher: devSwitcherEnabled(),

		// Who the viewer is, for Rejourney session identity (+layout.svelte). The
		// uid is an opaque cuid, not PII; role lets sessions be filtered by portal.
		userId: locals.user?.uid ?? null,
		userRole: locals.user?.role ?? null
	};
};
