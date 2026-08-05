<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toast } from '$lib/ui/toast.svelte';
	import { cn } from '$lib/utils';

	const TONE = {
		success: {
			bar: 'border-l-success-500',
			icon: 'border-success-200 bg-success-50 text-success-700',
			glyph: '✓'
		},
		danger: {
			bar: 'border-l-danger-500',
			icon: 'border-danger-200 bg-danger-50 text-danger-700',
			glyph: '✕'
		}
	} as const;
</script>

<!--
	Mounted once from the root layout. Replaces eight per-page implementations
	that had drifted to three different timeouts (3200 / 3500 / 3600ms).

	aria-live so a toast is announced; the container is always present so
	screen readers register the region before anything lands in it.
-->
<div
	class="pointer-events-none fixed right-7 bottom-7 z-[200] flex flex-col items-end gap-2"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toast.items as item (item.id)}
		<div
			in:fly={{ x: 60, duration: 280 }}
			out:fly={{ x: 60, duration: 200 }}
			class={cn(
				'pointer-events-auto flex max-w-90 min-w-56 items-center gap-3 rounded-lg border',
				'border-l-4 border-border bg-card px-4.5 py-3 shadow-md',
				TONE[item.tone].bar
			)}
		>
			<span
				class={cn(
					'flex size-5.5 shrink-0 items-center justify-center rounded-full border',
					TONE[item.tone].icon
				)}
				aria-hidden="true"
			>
				<span class="text-xs leading-none font-extrabold">{TONE[item.tone].glyph}</span>
			</span>

			<span class="text-base leading-snug font-medium text-foreground">{item.message}</span>

			<button
				type="button"
				onclick={() => toast.dismiss(item.id)}
				aria-label="Dismiss"
				class="-mr-1 ml-auto shrink-0 cursor-pointer rounded-sm border-none bg-transparent px-1
				       text-xs text-foreground-tertiary transition-colors hover:text-foreground
				       focus-visible:shadow-ring"
			>
				✕
			</button>
		</div>
	{/each}
</div>
