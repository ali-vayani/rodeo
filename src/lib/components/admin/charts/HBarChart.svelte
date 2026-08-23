<script lang="ts">
	import type { ValueCount } from '$lib/dashboard';

	// One hue for every bar: shading by size double-encodes length and implies a
	// ranking nominal categories do not carry.
	let {
		rows,
		ordered = false,
		emphasizeFirst = true,
		total = undefined,
		max: maxOverride = undefined,
		wideLabels = false
	}: {
		rows: ValueCount[];
		/** Keep the caller's order; right for ordinal fields like Year. */
		ordered?: boolean;
		/** Darken the leading bar. Off for ordinal data, where first isn't biggest. */
		emphasizeFirst?: boolean;
		/** Denominator for the hover percentage. Defaults to the sum of `rows`. */
		total?: number;
		/** Scale bars against this instead of the largest row. */
		max?: number;
		/** At the default width "University of Illinois Urbana-Champaign" and "...Chicago" truncate identically. */
		wideLabels?: boolean;
	} = $props();

	const nf = new Intl.NumberFormat('en-US');

	const sum = $derived(total ?? rows.reduce((acc, row) => acc + row.count, 0));
	const max = $derived(maxOverride ?? Math.max(1, ...rows.map((row) => row.count)));
	const leader = $derived(
		ordered || !emphasizeFirst ? null : rows.reduce((a, b) => (b.count > a.count ? b : a), rows[0])
	);
</script>

{#if rows.length === 0}
	<p class="py-4 text-center text-base text-foreground-secondary">Nothing recorded yet.</p>
{:else}
	<ul class="flex flex-col gap-2.5">
		{#each rows as row (row.label)}
			<li
				class="grid items-center gap-2.5 {wideLabels
					? 'grid-cols-[minmax(5rem,11rem)_1fr_auto]'
					: 'grid-cols-[minmax(4rem,7rem)_1fr_auto]'}"
			>
				<span class="truncate text-right text-xs text-foreground-secondary" title={row.label}>
					{row.label}
				</span>
				<div
					class="h-3 overflow-hidden rounded-sm bg-muted"
					title="{row.label} — {nf.format(row.count)}{sum > 0
						? ` (${((row.count / sum) * 100).toFixed(1)}%)`
						: ''}"
				>
					<!-- Square at the baseline, 4px on the data-end. -->
					<div
						class="h-full rounded-r-sm {row === leader ? 'bg-primary' : 'bg-neutral-700'}"
						style="width: {(row.count / max) * 100}%"
					></div>
				</div>
				<span class="w-10 text-right text-xs font-semibold text-foreground tabular-nums">
					{nf.format(row.count)}
				</span>
			</li>
		{/each}
	</ul>
{/if}
