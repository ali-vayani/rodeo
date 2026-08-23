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

{#if as === 'label'}
	<label for={htmlFor} class={cn(CLASS, 'block', className)}>{@render children()}</label>
{:else if as === 'span'}
	<span class={cn(CLASS, className)}>{@render children()}</span>
{:else}
	<div class={cn(CLASS, className)}>{@render children()}</div>
{/if}
