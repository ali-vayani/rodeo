<script lang="ts">
	import { cn } from '$lib/utils';
	import Button from '$lib/components/ui/Button.svelte';

	let {
		page,
		totalPages,
		loading = false,
		onChange,
		class: className = ''
	}: {
		page: number;
		totalPages: number;
		loading?: boolean;
		onChange: (page: number) => void;
		class?: string;
	} = $props();
</script>

{#if totalPages > 1}
	<div
		class={cn(
			'flex items-center justify-center gap-4 transition-opacity',
			loading && 'pointer-events-none opacity-50',
			className
		)}
	>
		<Button size="sm" disabled={page <= 1 || loading} onclick={() => onChange(page - 1)}>
			← Previous
		</Button>

		<span
			class="font-mono text-base whitespace-nowrap text-foreground-secondary tabular-nums"
			aria-live="polite"
		>
			{loading ? 'Loading…' : `Page ${page} of ${totalPages}`}
		</span>

		<Button size="sm" disabled={page >= totalPages || loading} onclick={() => onChange(page + 1)}>
			Next →
		</Button>
	</div>
{/if}
