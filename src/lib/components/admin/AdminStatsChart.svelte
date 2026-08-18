<script lang="ts">
	import { Card, EmptyState, Spinner } from '$lib/components/ui';
	import type { AdminStats, UnattributedStats } from '$lib/stats';
	import { pluralize } from '$lib/format';

	/**
	 * Per-admin review activity, ranked.
	 *
	 * Segment colours come from the status ramps, which is the one job colour does
	 * in this product — accepted/rejected/waitlisted genuinely are statuses, not
	 * arbitrary series. That ramp puts green next to red, a pair colour-blind
	 * readers separate poorly (ΔE 6.3 deutan) and which clears neither swatch the
	 * 3:1 contrast bar against a white card. Both are why **every segment is also
	 * spelled out as a number underneath**: the bar is the comparison, the digits
	 * are the data, and nothing here is legible by hue alone.
	 */
	/**
	 * The time window used to live here, as a `Select` in this card's header. It
	 * moved up to the dashboard, which now owns one range for every panel that can
	 * honestly be scoped by one — a filter inside a chart card lets two panels side
	 * by side describe different slices with nothing on screen saying so.
	 */
	let {
		admins,
		unattributed,
		loading = false
	}: {
		admins: AdminStats[];
		unattributed: UnattributedStats;
		loading?: boolean;
	} = $props();

	/**
	 * Written out rather than built as `bg-${tone}-500` — Tailwind scans source
	 * text statically and never sees a constructed class name.
	 */
	const SEGMENTS = [
		{ key: 'accepted', label: 'Accepted', bar: 'bg-success-500', dot: 'bg-success-500' },
		{ key: 'rejected', label: 'Rejected', bar: 'bg-danger-500', dot: 'bg-danger-500' },
		{ key: 'waitlisted', label: 'Waitlisted', bar: 'bg-warning-500', dot: 'bg-warning-500' }
	] as const;

	// Everyone with something to show. The query zero-fills the full staff roster so
	// the shape is stable, but rendering 60 empty rows buries the handful of people
	// who actually reviewed anything.
	const active = $derived(
		admins.filter((a) => a.decisions > 0 || a.emailCampaigns > 0 || a.scans > 0)
	);

	// Bars are scaled against the busiest reviewer, not each to their own 100% —
	// normalising per row would draw one decision the same width as two hundred.
	const maxDecisions = $derived(Math.max(1, ...active.map((a) => a.decisions)));

	const nf = new Intl.NumberFormat('en-US');
</script>

<Card title="Admin activity" class="h-full">
	{#snippet actions()}
		<span class="font-mono text-2xs text-foreground-tertiary">
			decisions are current · scans and emails accumulate
		</span>
	{/snippet}

	{#if loading}
		<div class="flex justify-center py-8"><Spinner /></div>
	{:else if active.length === 0}
		<EmptyState
			compact
			title="No activity"
			message="Decisions, emails and scans appear here as admins work through applications."
		/>
	{:else}
		<!-- Legend. Present because there is more than one series, so identity never
		     rests on colour alone. -->
		<div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
			{#each SEGMENTS as segment (segment.key)}
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-full {segment.dot}"></span>
					<span class="text-xs text-foreground-secondary">{segment.label}</span>
				</div>
			{/each}
		</div>

		<ul class="flex flex-col gap-3.5">
			{#each active as admin (admin.uid)}
				<li>
					<div class="mb-1.5 flex items-baseline justify-between gap-3">
						<span class="truncate text-base font-medium text-foreground">{admin.name}</span>
						<span class="shrink-0 font-mono text-base text-foreground tabular-nums">
							{nf.format(admin.decisions)}
						</span>
					</div>

					<!-- 2px gaps between fills, so adjacent segments stay separable where the
					     hues themselves don't. -->
					<div class="flex h-2 gap-0.5" role="presentation">
						{#each SEGMENTS as segment (segment.key)}
							{@const count = admin[segment.key]}
							{#if count > 0}
								<div
									class="rounded-sm {segment.bar}"
									style="width: {(count / maxDecisions) * 100}%"
									title="{nf.format(count)} {segment.label.toLowerCase()}"
								></div>
							{/if}
						{/each}
					</div>

					<!-- The numbers the bar stands in for. Text keeps text tokens; the bar
					     above carries the identity. -->
					<div
						class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-2xs text-foreground-tertiary tabular-nums"
					>
						{#each SEGMENTS as segment (segment.key)}
							<span>{nf.format(admin[segment.key])} {segment.label.toLowerCase()}</span>
						{/each}
						{#if admin.emailCampaigns > 0}
							<span>
								{nf.format(admin.emailCampaigns)}
								{pluralize(admin.emailCampaigns, 'send')} · {nf.format(admin.emailRecipients)}
								{pluralize(admin.emailRecipients, 'email')}
							</span>
						{/if}
						{#if admin.scans > 0}
							<span>{nf.format(admin.scans)} {pluralize(admin.scans, 'scan')}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		{#if unattributed.total > 0}
			<!-- Decisions nobody is on the hook for: made before attribution existed, or
			     by the blacklist auto-reject, which no admin triggered. Shown rather than
			     dropped so the bars above sum to the real decision totals. -->
			<!-- `pluralize` already emits the count, so pairing it with a formatted
			     number printed "98 unattributed 98 decisions". The formatted number wins
			     — it is the one that groups thousands. -->
			<p class="mt-4 border-t border-border pt-3 text-xs text-foreground-tertiary">
				<span class="font-mono tabular-nums">{nf.format(unattributed.total)}</span>
				unattributed {unattributed.total === 1 ? 'decision' : 'decisions'} — recorded before attribution
				existed, or applied automatically.
			</p>
		{/if}
	{/if}
</Card>
