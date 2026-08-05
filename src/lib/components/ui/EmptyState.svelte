<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import Eyebrow from './Eyebrow.svelte';

	let {
		message,
		title = undefined,
		compact = false,
		class: className = '',
		action
	}: {
		message: string;
		/** Optional eyebrow above the message, naming what is empty. */
		title?: string;
		/** Tighter padding, for empty states inside a panel rather than a page. */
		compact?: boolean;
		class?: string;
		action?: Snippet;
	} = $props();
</script>

<!--
	Replaces six different treatments across the app: two centered blocks at
	different paddings and type sizes, a third with horizontal padding as well,
	an italic inline span, a bare paragraph, and a scoped-CSS one.
-->
<div
	class={cn(
		'flex flex-col items-center justify-center gap-2 text-center',
		compact ? 'py-6' : 'py-10',
		className
	)}
>
	{#if title}<Eyebrow>{title}</Eyebrow>{/if}
	<p class="m-0 text-base text-foreground-secondary">{message}</p>
	{#if action}<div class="mt-1">{@render action()}</div>{/if}
</div>
