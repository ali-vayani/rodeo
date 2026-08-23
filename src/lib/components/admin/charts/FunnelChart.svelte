<script lang="ts">
	import type { FunnelStage } from '$lib/dashboard';

	// Single ink hue: length already encodes the count, and colour on this dashboard
	// means decision status. Grid, not flex, so the counts line up in their own column.
	let { stages }: { stages: FunnelStage[] } = $props();

	const nf = new Intl.NumberFormat('en-US');

	// Scaled against the first stage, not the largest, so a growing stage never redraws the ones above.
	const base = $derived(Math.max(1, stages[0]?.count ?? 1));
</script>

<ol class="flex flex-col">
	{#each stages as stage (stage.key)}
		<!-- Stacked below sm: side by side leaves the bar ~50px on a 390px screen. -->
		<li
			class="grid grid-cols-1 gap-1 border-b border-border-subtle py-2 last:border-b-0 sm:grid-cols-[minmax(6rem,7.5rem)_1fr] sm:items-center sm:gap-3"
		>
			<div class="min-w-0">
				<div class="truncate text-base font-semibold text-foreground">{stage.label}</div>
				<div class="truncate text-2xs text-foreground-tertiary">{stage.hint}</div>
			</div>

			<div
				class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[1fr_auto_auto]"
			>
				<div class="min-w-0">
					<!-- Square at the baseline, 4px on the data-end. -->
					<div
						class="h-5 min-w-0.5 rounded-r-sm bg-neutral-700"
						style="width: {(stage.count / base) * 100}%"
					></div>
				</div>
				<span class="w-12 text-right text-lg font-bold text-foreground tabular-nums sm:w-14">
					{nf.format(stage.count)}
				</span>
				<!-- Wraps below sm rather than being dropped: the conversion is the stage's point. -->
				<span class="col-span-2 justify-self-end sm:col-span-1 sm:w-28 sm:justify-self-start">
					{#if stage.conversion !== null}
						<span
							class="rounded-full border border-border px-1.5 py-px font-mono text-2xs whitespace-nowrap text-foreground-tertiary"
						>
							{(stage.conversion * 100).toFixed(1)}% {stage.conversionOf}
						</span>
					{/if}
				</span>
			</div>
		</li>
	{/each}
</ol>
