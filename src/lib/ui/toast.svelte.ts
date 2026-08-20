/**
 * App-wide toast store.
 *
 * Eight pages each carried their own `showToast` + timer + `{#if toast}` block. Six
 * were byte-identical at 3200ms; application-editor had drifted to 3500ms and
 * blacklist to 3600ms, so the same feature behaved three different ways.
 *
 * `ToastHost` renders this once from the root layout. Callers just do:
 *
 *     toast.success('Event added');
 */

import type { Tone } from './tone';
import { errorMessage } from './errors';

/** How long a toast stays up. One number, one place. */
const DURATION_MS = 3200;

/** Beyond this, older toasts are dropped rather than stacked off-screen. */
const MAX_VISIBLE = 3;

export interface ToastItem {
	id: number;
	message: string;
	tone: Extract<Tone, 'success' | 'danger'>;
	/** Its own expiry handle, kept on the item so there is no side table to sync. */
	timer?: ReturnType<typeof setTimeout>;
}

let nextId = 0;

const items = $state<ToastItem[]>([]);

function push(message: string, tone: ToastItem['tone']): number {
	const id = nextId++;
	const item: ToastItem = { id, message, tone };
	item.timer = setTimeout(() => dismiss(id), DURATION_MS);
	items.push(item);

	// Drop from the front so the newest — the one that matches what the user
	// just did — is always the one that survives.
	while (items.length > MAX_VISIBLE) {
		const evicted = items.shift();
		if (evicted?.timer) clearTimeout(evicted.timer);
	}

	return id;
}

function dismiss(id: number) {
	const index = items.findIndex((item) => item.id === id);
	if (index === -1) return;

	const [removed] = items.splice(index, 1);
	if (removed?.timer) clearTimeout(removed.timer);
}

export const toast = {
	/** Live list, read by `ToastHost`. */
	get items(): ToastItem[] {
		return items;
	},

	success: (message: string) => push(message, 'success'),
	error: (message: string) => push(message, 'danger'),

	/**
	 * Report a caught error. Falls back to `fallback` when the thrown value has no
	 * usable message, which is what every page's local helper was doing by hand.
	 */
	fromError(error: unknown, fallback: string) {
		return push(errorMessage(error, fallback), 'danger');
	},

	dismiss,

	/** Route changes shouldn't carry stale feedback onto the next screen. */
	clear() {
		for (const item of items) if (item.timer) clearTimeout(item.timer);
		items.length = 0;
	}
};
