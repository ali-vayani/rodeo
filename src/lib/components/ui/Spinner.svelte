<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		size = 'sm',
		class: className = '',
		label = 'Loading'
	}: {
		size?: 'sm' | 'md';
		class?: string;
		/** Screen-reader text. Set to '' when an adjacent label already says it. */
		label?: string;
	} = $props();

	const SIZES = { sm: 'size-3 border-2', md: 'size-4 border-2' };
</script>

<span
	class={cn(
		'inline-block animate-spin rounded-full border-current border-t-transparent',
		SIZES[size],
		className
	)}
	role={label ? 'status' : undefined}
	aria-hidden={label ? undefined : 'true'}
>
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>
