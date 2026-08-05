<script lang="ts">
	import type { DayTab } from '$lib/schedule/types';
	import { cn } from '$lib/utils';

	let {
		days,
		selected,
		counts,
		onSelect
	}: {
		days: DayTab[];
		selected: string;
		counts: Record<string, number>;
		onSelect: (key: string) => void;
	} = $props();
</script>

<!--
	Deliberately not the shared Tabs component: each day carries a date sublabel
	and a count alongside its label, which Tabs has no room for. Same tokens,
	different control.
-->
<div class="mb-4 flex flex-wrap gap-2">
	{#each days as day (day.key)}
		{@const active = selected === day.key}
		<button
			type="button"
			onclick={() => onSelect(day.key)}
			aria-pressed={active}
			class={cn(
				'flex cursor-pointer items-baseline gap-2 rounded-md border px-3.5 py-2 text-base',
				'transition-colors duration-150 focus-visible:shadow-ring',
				active
					? 'border-primary bg-primary font-semibold text-primary-foreground'
					: 'border-border bg-card font-normal text-foreground-secondary hover:text-foreground'
			)}
		>
			<span>{day.label}</span>
			<span class={cn('font-mono text-xs', active && 'text-primary-foreground/70')}>
				{day.sublabel}
			</span>
			<span
				class={cn(
					'rounded-sm border px-1.5 py-0.5 font-mono text-2xs tabular-nums',
					active
						? 'border-primary-foreground/25 text-primary-foreground/70'
						: 'border-border bg-muted text-foreground-secondary'
				)}
			>
				{counts[day.key] ?? 0}
			</span>
		</button>
	{/each}
</div>
