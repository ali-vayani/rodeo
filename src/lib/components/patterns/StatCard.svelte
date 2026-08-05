<script lang="ts">
	import { cn } from '$lib/utils';
	import Eyebrow from '$lib/components/ui/Eyebrow.svelte';
	import type { Tone } from '$lib/ui/tone';

	let {
		label,
		value,
		hint = undefined,
		tone = 'neutral',
		class: className = ''
	}: {
		label: string;
		value: string | number;
		hint?: string;
		/** Colors the value. Use sparingly — a wall of colored stats says nothing. */
		tone?: Tone;
		class?: string;
	} = $props();

	const TONES: Record<Tone, string> = {
		neutral: 'text-foreground',
		success: 'text-success-700',
		warning: 'text-warning-700',
		danger: 'text-danger-700',
		info: 'text-info-700'
	};
</script>

<div class={cn('rounded-lg border border-border bg-card p-4 shadow-sm', className)}>
	<div class={cn('font-mono text-3xl leading-none font-medium tabular-nums', TONES[tone])}>
		{value}
	</div>
	<Eyebrow class="mt-1.5">{label}</Eyebrow>
	{#if hint}<p class="mt-1 mb-0 text-xs text-foreground-tertiary">{hint}</p>{/if}
</div>
