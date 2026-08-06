import type { LayoutServerLoad } from './$types';
import { devSwitcherEnabled } from '$lib/server/env';

export const load: LayoutServerLoad = async () => {
	return {
		// Whether to mount the account switcher. `dev` alone can't decide this in
		// the layout: it is a build-time constant that is false in every built
		// bundle, and preview deploys are built bundles that DO get the switcher.
		devSwitcher: devSwitcherEnabled()
	};
};
