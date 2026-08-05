<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		as = 'div',
		for: htmlFor = undefined,
		class: className = '',
		children
	}: {
		/** Use 'label' when this titles a form control. */
		as?: 'div' | 'span' | 'label';
		for?: string;
		class?: string;
		children: Snippet;
	} = $props();

	const CLASS =
		'font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase';
</script>

<!--
	The single most-repeated string in the app: ~35 uses across 40 slightly
	different class strings, disagreeing on size (9px/10px/11px/12px), weight,
	tracking (0.05em through 0.12em), and color.
-->
{#if as === 'label'}
	<label for={htmlFor} class={cn(CLASS, 'block', className)}>{@render children()}</label>
{:else if as === 'span'}
	<span class={cn(CLASS, className)}>{@render children()}</span>
{:else}
	<div class={cn(CLASS, className)}>{@render children()}</div>
{/if}
