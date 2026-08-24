/**
 * Holds a navigation while the page still has unsaved work.
 *
 * The three editors that needed this were each calling `confirm()`, which cannot offer
 * the one answer a reader actually wants — save, then go. This owns the interception so
 * the answer can be a real modal; see `UnsavedChangesModal`.
 */

import { beforeNavigate, goto } from '$app/navigation';

export interface UnsavedGuard {
	/** Whether a navigation is being held. Drive the modal's `open` from this. */
	readonly open: boolean;
	/** Stay put, and forget where they were going. */
	dismiss(): void;
	/** Go there anyway. Safe to call after a save, too. */
	proceed(): void;
}

/**
 * Inputs:
 * - isDirty: () => boolean — a getter, not a value, so the guard reads the caller's
 *   live `$derived` at navigation time rather than freezing it at setup.
 *
 * Outputs:
 * - UnsavedGuard
 *
 * Call from a component's top level: `beforeNavigate` is only legal during init.
 */
export function createUnsavedGuard(isDirty: () => boolean): UnsavedGuard {
	let pending = $state<URL | null>(null);
	/** Set while the guard is letting its own `goto` back out. */
	let leaving = false;

	beforeNavigate((nav) => {
		if (leaving || !isDirty()) return;

		// A tab close or a link off the app cannot be held for a modal of ours — the
		// document is going away regardless. Cancelling raises the browser's own dialog,
		// which is the only thing that works there.
		if (nav.willUnload) {
			nav.cancel();
			return;
		}

		if (!nav.to?.url) return;
		nav.cancel();
		pending = nav.to.url;
	});

	return {
		get open() {
			return pending !== null;
		},
		dismiss() {
			pending = null;
		},
		proceed() {
			const url = pending;
			pending = null;
			if (!url) return;
			leaving = true;
			// `nav.to.url` came from SvelteKit already resolved, base path and all. Passing it
			// through `resolve()` to satisfy the rule would prefix the base a second time.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(url).finally(() => (leaving = false));
		}
	};
}
