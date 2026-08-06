/**
 * The shell every form control shares — input, textarea, select trigger.
 *
 * Kept here rather than in one of the components so a select and a text input
 * are provably the same height and share one focus treatment. The audit found
 * 46 inputs, 5 textareas and 11 selects each with their own hand-written
 * border, padding, and focus state.
 */

import { cn } from '$lib/utils';

/** Height, radius, type, and the focus/disabled behavior. No border color.
 *  16px type below sm (iOS Safari zooms the page on focusing anything smaller),
 *  the compact 13px scale from sm up. */
export const CONTROL_BASE =
	'w-full rounded-md bg-card text-touch sm:text-base text-foreground ' +
	'transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-faint ' +
	'focus-visible:border-primary focus-visible:shadow-ring ' +
	'disabled:cursor-not-allowed disabled:bg-muted disabled:text-faint';

/** Fixed-height controls: input, select trigger. Textareas set their own. */
export const CONTROL_SIZED = 'h-8 px-3';

export function controlBorder(invalid: boolean): string {
	return invalid
		? 'border border-danger-500 focus-visible:border-danger-500 focus-visible:shadow-ring-danger'
		: 'border border-border';
}

export function controlClass(options: {
	invalid?: boolean;
	mono?: boolean;
	sized?: boolean;
	class?: string;
}): string {
	return cn(
		CONTROL_BASE,
		options.sized !== false && CONTROL_SIZED,
		controlBorder(Boolean(options.invalid)),
		options.mono && 'font-mono',
		options.class
	);
}
