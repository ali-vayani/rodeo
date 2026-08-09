<script lang="ts">
	import type { FunnelStage } from '$lib/dashboard';

	/**
	 * The admissions pipeline, stage by stage.
	 *
	 * Single ink hue throughout. Bar length already encodes the count, so tinting
	 * each stage a different colour would spend the page's one free channel
	 * restating what the reader can already see — and would put four more colours
	 * beside the decision bar, where colour means something specific.
	 *
	 * Laid out as a grid rather than a flex row so the counts line up in their own
	 * column down the funnel. Under flex, a 100%-wide first bar squeezes its own
	 * label against the card edge and the numbers stagger.
	 */
	let { stages }: { stages: FunnelStage[] } = $props();

	const nf = new Intl.NumberFormat('en-US');

	// Scaled against the first stage — the funnel's own 100% — not against the
	// largest, so a stage that grows can never redraw the ones above it.
	const base = $derived(Math.max(1, stages[0]?.count ?? 1));
</script>

<ol class="flex flex-col">
	{#each stages as stage (stage.key)}
		<!-- Stacked below sm. Side by side, the label column plus the count and the
		     conversion chip leave the bar about 50px on a 390px screen, which draws
		     every stage as the same thin sliver — the chart stops being a chart. -->
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
				<!-- Wraps to its own row below sm rather than being dropped: the
				     conversion is the number the stage exists to report, and hiding it on
				     a phone would make the mobile funnel a different chart. -->
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
