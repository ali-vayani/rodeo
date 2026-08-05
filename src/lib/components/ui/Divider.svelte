<script lang="ts">
	import { cn } from '$lib/utils';
	import Eyebrow from './Eyebrow.svelte';

	let {
		label = undefined,
		class: className = ''
	}: {
		/** Inset caption, for splitting a long form into named sections. */
		label?: string;
		class?: string;
	} = $props();
</script>

{#if label}
	<div class={cn('flex items-center gap-3', className)} role="separator" aria-label={label}>
		<Eyebrow class="shrink-0">{label}</Eyebrow>
		<span class="h-px flex-1 bg-border-subtle"></span>
	</div>
{:else}
	<hr class={cn('m-0 border-0 border-t border-border-subtle', className)} />
{/if}
