<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import Eyebrow from './Eyebrow.svelte';

	let {
		title = undefined,
		padding = 'md',
		class: className = '',
		bodyClass = '',
		header,
		actions,
		footer,
		children
	}: {
		/** Renders the muted header bar. Ignored when a `header` snippet is given. */
		title?: string;
		padding?: 'none' | 'sm' | 'md';
		class?: string;
		bodyClass?: string;
		/** Full control of the header bar, replacing `title`. */
		header?: Snippet;
		/** Right-aligned content in the header bar, alongside `title`. */
		actions?: Snippet;
		footer?: Snippet;
		children: Snippet;
	} = $props();

	const PADDING = { none: '', sm: 'p-4', md: 'p-5' };
	const hasHeader = $derived(Boolean(header || title));
</script>

<div class={cn('overflow-hidden rounded-lg border border-border bg-card shadow-sm', className)}>
	{#if hasHeader}
		<div
			class="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2.5"
		>
			{#if header}
				{@render header()}
			{:else}
				<Eyebrow>{title}</Eyebrow>
				{#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
			{/if}
		</div>
	{/if}

	<div class={cn(PADDING[padding], bodyClass)}>
		{@render children()}
	</div>

	{#if footer}
		<div class="flex justify-end gap-2 border-t border-border px-4 py-3">
			{@render footer()}
		</div>
	{/if}
</div>
