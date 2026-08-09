<script lang="ts">
	import { cn } from '$lib/utils';

	/**
	 * A small set of mutually exclusive choices, all visible at once.
	 *
	 * Distinct from `Select`, which hides its options behind a trigger. Use this
	 * when the options are few, short, and worth showing — a time range the reader
	 * should be able to see they *could* change, rather than one they must open a
	 * menu to discover.
	 *
	 * Radio semantics rather than a row of buttons: arrow keys move between
	 * options and only the selected one is a tab stop, which is what a screen
	 * reader announces as a group of choices instead of five unrelated actions.
	 */
	let {
		value = $bindable(),
		options,
		ariaLabel,
		size = 'md',
		disabled = false,
		onValueChange,
		class: className = ''
	}: {
		value: string;
		options: Array<{ value: string; label: string }>;
		ariaLabel: string;
		size?: 'sm' | 'md';
		disabled?: boolean;
		onValueChange?: (value: string) => void;
		class?: string;
	} = $props();

	const SIZES = { sm: 'h-6 px-2 text-2xs', md: 'h-7 px-2.5 text-xs' };

	function select(next: string) {
		if (disabled || next === value) return;
		value = next;
		onValueChange?.(next);
	}

	/** Arrow keys wrap, matching the radio-group pattern the role implies. */
	function onKeydown(event: KeyboardEvent, index: number) {
		const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
		const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
		if (!back && !forward) return;
		event.preventDefault();
		const next = options[(index + (forward ? 1 : -1) + options.length) % options.length];
		select(next.value);
		// Focus follows selection so the next arrow press continues from where the
		// reader is, not from where they started.
		const group = (event.currentTarget as HTMLElement).parentElement;
		group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
	}
</script>

<div
	role="radiogroup"
	aria-label={ariaLabel}
	class={cn(
		'inline-flex gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-xs',
		disabled && 'opacity-60',
		className
	)}
>
	{#each options as option, index (option.value)}
		{@const selected = option.value === value}
		<button
			type="button"
			role="radio"
			data-value={option.value}
			aria-checked={selected}
			tabindex={selected ? 0 : -1}
			{disabled}
			onclick={() => select(option.value)}
			onkeydown={(event) => onKeydown(event, index)}
			class={cn(
				'rounded-sm font-semibold whitespace-nowrap transition-colors duration-150',
				'focus-visible:shadow-ring focus-visible:outline-none',
				SIZES[size],
				selected
					? 'bg-primary text-primary-foreground'
					: 'text-foreground-secondary hover:text-foreground',
				disabled && 'cursor-not-allowed'
			)}
		>
			{option.label}
		</button>
	{/each}
</div>
