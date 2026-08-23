<script lang="ts">
	import { Tooltip } from '$lib/components/ui';
	import { cn } from '$lib/utils';
	import { DECISION_SERIES, type DecisionKey } from './decisionPalette';

	// Applicants by decision as one 100%-stacked bar. Segments are separated by a 2px
	// surface gap, never a border; see `decisionPalette` for why the gap is mandatory.
	let {
		counts,
		byRole = undefined,
		total
	}: {
		counts: Record<DecisionKey, number>;
		/** Role split per decision, surfaced on hover. */
		byRole?: Partial<Record<DecisionKey, Array<{ label: string; value: number }>>>;
		total: number;
	} = $props();

	let showTable = $state(false);

	const nf = new Intl.NumberFormat('en-US');
	const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
	const fmtPct = (n: number) => `${pct(n).toFixed(1)}%`;

	const segments = $derived(
		DECISION_SERIES.map((series) => ({
			...series,
			count: counts[series.key] ?? 0,
			share: pct(counts[series.key] ?? 0)
		})).filter((segment) => segment.count > 0)
	);

	// A label in a 3% sliver overflows or crops; the legend carries every value anyway.
	const LABEL_MIN_SHARE = 9;

	function tooltipFor(key: DecisionKey, label: string, hint: string, count: number) {
		const rows = (byRole?.[key] ?? []).filter((row) => row.value > 0);
		return [
			`${label} — ${nf.format(count)} (${fmtPct(count)})`,
			hint,
			...rows.map((row) => `${row.label} — ${nf.format(row.value)}`)
		].join('\n');
	}
</script>

<div>
	<div class="mb-3 flex items-center justify-between gap-3">
		<p class="text-xs text-foreground-secondary">
			{nf.format(total)} applicants · staff accounts excluded
		</p>
		<!-- Two fills sit below 3:1 against the card, so a non-colour route to the numbers must exist. -->
		<button
			type="button"
			aria-pressed={showTable}
			onclick={() => (showTable = !showTable)}
			class="rounded-sm px-1.5 py-0.5 text-xs font-semibold text-foreground-secondary hover:bg-muted hover:text-foreground focus-visible:shadow-ring focus-visible:outline-none"
		>
			{showTable ? 'Chart' : 'Table'}
		</button>
	</div>

	{#if showTable}
		<table class="w-full border-collapse text-base">
			<thead>
				<tr class="border-b border-border text-left">
					<th
						class="pb-2 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Decision
					</th>
					<th
						class="pb-2 text-right font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Applicants
					</th>
					<th
						class="pb-2 text-right font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Share
					</th>
				</tr>
			</thead>
			<tbody>
				{#each DECISION_SERIES as series (series.key)}
					<tr class="border-b border-border-subtle last:border-b-0">
						<td class="flex items-center gap-2 py-1.5">
							<span class="size-2 shrink-0 rounded-full {series.dot}"></span>
							{series.label}
						</td>
						<td class="py-1.5 text-right tabular-nums">{nf.format(counts[series.key] ?? 0)}</td>
						<td class="py-1.5 text-right text-foreground-secondary tabular-nums">
							{fmtPct(counts[series.key] ?? 0)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-semibold">
					<td class="pt-2">Total</td>
					<td class="pt-2 text-right tabular-nums">{nf.format(total)}</td>
					<td class="pt-2 text-right tabular-nums">100%</td>
				</tr>
			</tfoot>
		</table>
	{:else}
		<!-- gap-0.5 is the 2px surface gap. -->
		<div class="flex h-7 gap-0.5" role="img" aria-label="Applicants by decision">
			{#each segments as segment (segment.key)}
				<Tooltip content={tooltipFor(segment.key, segment.label, segment.hint, segment.count)}>
					{#snippet children(props)}
						<!-- A real <button>: the role split behind each segment must be keyboard-reachable. -->
						<button
							{...props}
							type="button"
							aria-label={tooltipFor(segment.key, segment.label, segment.hint, segment.count)}
							style="width: {segment.share}%"
							class={cn(
								'flex cursor-help items-center justify-center transition-[filter] duration-150 hover:brightness-95',
								// Rounded only at the outer ends: one bar, not four pills.
								'first:rounded-l-sm last:rounded-r-sm',
								'focus-visible:shadow-ring focus-visible:outline-none',
								segment.fill
							)}
						>
							{#if segment.share >= LABEL_MIN_SHARE}
								<span class="font-mono text-2xs font-medium {segment.inlineText}">
									{nf.format(segment.count)}
								</span>
							{/if}
						</button>
					{/snippet}
				</Tooltip>
			{/each}
		</div>

		<!-- Carries every value, so no number here is reachable only by hovering. -->
		<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
			{#each DECISION_SERIES as series (series.key)}
				<li class="flex items-center gap-1.5 text-xs text-foreground-secondary">
					<span class="size-2 shrink-0 rounded-full {series.dot}"></span>
					{series.label}
					<b class="font-semibold text-foreground tabular-nums">
						{nf.format(counts[series.key] ?? 0)}
					</b>
					<span class="font-mono text-2xs text-foreground-tertiary">
						{fmtPct(counts[series.key] ?? 0)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
