<script lang="ts">
	import { Card, EmptyState, Select, Spinner } from '$lib/components/ui';
	import type { SelectOption } from '$lib/components/ui/types';
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
	let {
		admins,
		unattributed,
		window = $bindable('all'),
		loading = false,
		onWindowChange
	}: {
		admins: AdminStats[];
		unattributed: UnattributedStats;
		window?: string;
		loading?: boolean;
		onWindowChange?: (value: string) => void;
	} = $props();

	const WINDOW_OPTIONS: SelectOption[] = [
		{ value: 'all', label: 'All time' },
		{ value: '30d', label: 'Last 30 days' },
		{ value: '7d', label: 'Last 7 days' }
	];

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
		<Select
			bind:value={window}
			options={WINDOW_OPTIONS}
			ariaLabel="Time window"
			onValueChange={(v) => onWindowChange?.(v)}
		/>
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
			<p class="mt-4 border-t border-border pt-3 text-xs text-foreground-tertiary">
				<span class="font-mono tabular-nums">{nf.format(unattributed.total)}</span>
				unattributed {pluralize(unattributed.total, 'decision')} — recorded before attribution existed,
				or applied automatically.
			</p>
		{/if}
	{/if}
</Card>
