<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		title,
		subtitle = undefined,
		class: className = '',
		meta,
		actions,
		description
	}: {
		title: string;
		subtitle?: string;
		class?: string;
		/** Small right-aligned status text — a count, a last-updated stamp. */
		meta?: Snippet;
		/** Buttons, right-aligned. */
		actions?: Snippet;
		/** Richer subtitle when a plain string isn't enough. */
		description?: Snippet;
	} = $props();
</script>

<div class={cn('mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
	<div class="min-w-0">
		<h1 class="m-0 text-2xl font-bold text-foreground">{title}</h1>
		{#if description}
			<div class="mt-1 text-base text-foreground-secondary">{@render description()}</div>
		{:else if subtitle}
			<p class="mt-1 mb-0 text-base text-foreground-secondary">{subtitle}</p>
		{/if}
	</div>

	{#if actions || meta}
		<div class="flex flex-wrap items-center gap-3">
			{#if meta}<span class="font-mono text-xs text-foreground-tertiary">{@render meta()}</span
				>{/if}
			{#if actions}{@render actions()}{/if}
		</div>
	{/if}
</div>
