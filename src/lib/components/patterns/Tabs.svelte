<script lang="ts">
	import { cn } from '$lib/utils';
	import type { TabItem } from '$lib/components/ui/types';

	let {
		tabs,
		active = $bindable(''),
		orientation = 'horizontal',
		onChange = undefined,
		class: className = ''
	}: {
		tabs: TabItem[];
		active?: string;
		/** Vertical is the left rail used by settings, email templates, and the
		    custom-email step list. */
		orientation?: 'horizontal' | 'vertical';
		/** Fires after a selection. For callers whose tab change has a side effect
		    — the custom-email wizard re-counts recipients on reaching step 3. */
		onChange?: (value: string) => void;
		class?: string;
	} = $props();

	function select(tab: TabItem) {
		if (tab.disabled) return;
		active = tab.value;
		onChange?.(tab.value);
	}

	/** Arrow keys move between tabs, per the WAI-ARIA tabs pattern. */
	function onKeydown(event: KeyboardEvent) {
		const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
		const back = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
		if (event.key !== forward && event.key !== back) return;

		event.preventDefault();
		const enabled = tabs.filter((tab) => !tab.disabled);
		const index = enabled.findIndex((tab) => tab.value === active);
		const next =
			event.key === forward
				? enabled[(index + 1) % enabled.length]
				: enabled[(index - 1 + enabled.length) % enabled.length];
		if (!next) return;

		select(next);
		// Roving tabindex means the newly selected tab is the only focusable one,
		// so focus has to follow the selection or it strands on a tabindex="-1".
		const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
		tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.indexOf(next)]?.focus();
	}
</script>

<div
	role="tablist"
	aria-orientation={orientation}
	class={cn(
		orientation === 'horizontal'
			? 'flex gap-0.5 overflow-x-auto border-b border-border'
			: cn(
					'flex w-40 shrink-0 flex-col border-r border-border',
					// Below md a left rail has no room to live beside its panel, so
					// the vertical variant flattens into a scrollable strip on top.
					'max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b'
				),
		className
	)}
>
	{#each tabs as tab (tab.value)}
		{@const selected = tab.value === active}
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			disabled={tab.disabled}
			tabindex={selected ? 0 : -1}
			onclick={() => select(tab)}
			onkeydown={onKeydown}
			class={cn(
				'flex cursor-pointer items-center gap-2 border-none bg-transparent text-base',
				'transition-colors duration-150 focus-visible:shadow-ring',
				'disabled:pointer-events-none disabled:opacity-40',
				orientation === 'horizontal'
					? 'shrink-0 border-b-2 border-solid px-3.5 py-2 whitespace-nowrap'
					: cn(
							'border-b border-solid border-b-border px-3.5 py-2.5 text-left',
							'max-md:shrink-0 max-md:border-b-0 max-md:whitespace-nowrap'
						),
				selected
					? orientation === 'horizontal'
						? 'border-b-primary font-semibold text-foreground'
						: 'bg-card font-semibold text-foreground'
					: cn(
							'text-foreground-secondary hover:text-foreground',
							orientation === 'horizontal' ? 'border-b-transparent' : 'bg-muted'
						)
			)}
		>
			<span class="truncate">{tab.label}</span>
			{#if tab.badge !== undefined}
				<span class="ml-auto font-mono text-2xs text-foreground-tertiary">{tab.badge}</span>
			{/if}
		</button>
	{/each}
</div>
