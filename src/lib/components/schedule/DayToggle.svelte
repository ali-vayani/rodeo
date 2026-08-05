<script lang="ts">
	import type { DayTab } from '$lib/schedule/types';

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

<div class="mb-4 flex flex-wrap gap-2">
	{#each days as day (day.key)}
		<button
			onclick={() => onSelect(day.key)}
			aria-pressed={selected === day.key}
			class="flex cursor-pointer items-baseline gap-2 rounded-md border px-[14px] py-2 text-[13px] transition-colors {selected ===
			day.key
				? 'border-primary bg-primary font-semibold text-white'
				: 'border-border bg-white font-normal text-muted-foreground hover:text-primary'}"
		>
			<span>{day.label}</span>
			<span class="font-mono text-[11px] {selected === day.key ? 'text-[#cccccc]' : ''}">
				{day.sublabel}
			</span>
			<span
				class="rounded border px-1.5 py-0.5 font-mono text-[10px] {selected === day.key
					? 'border-white/25 text-[#cccccc]'
					: 'border-border bg-muted text-muted-foreground'}"
			>
				{counts[day.key] ?? 0}
			</span>
		</button>
	{/each}
</div>
