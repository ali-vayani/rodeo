<script lang="ts">
	import { Card, EmptyState, Spinner } from '$lib/components/ui';
	import type { AdminStats, UnattributedStats } from '$lib/stats';
	import { pluralize } from '$lib/format';

	// Per-admin review activity. The status ramp puts green beside red (delta-E 6.3
	// deutan, neither at 3:1 on white), so every segment is also written out as a number.
	let {
		admins,
		unattributed,
		loading = false
	}: {
		admins: AdminStats[];
		unattributed: UnattributedStats;
		loading?: boolean;
	} = $props();

	// Literal class names: Tailwind scans source statically and never sees `bg-${tone}-500`.
	const SEGMENTS = [
		{ key: 'accepted', label: 'Accepted', bar: 'bg-success-500', dot: 'bg-success-500' },
		{ key: 'rejected', label: 'Rejected', bar: 'bg-danger-500', dot: 'bg-danger-500' },
		{ key: 'waitlisted', label: 'Waitlisted', bar: 'bg-warning-500', dot: 'bg-warning-500' }
	] as const;

	// The query zero-fills the whole staff roster; 60 empty rows would bury the reviewers.
	const active = $derived(
		admins.filter((a) => a.decisions > 0 || a.emailCampaigns > 0 || a.scans > 0)
	);

	// Scaled against the busiest reviewer; per-row 100% would draw 1 decision as wide as 200.
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
		<!-- Legend: more than one series, so identity never rests on colour alone. -->
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

					<!-- 2px gaps keep adjacent segments separable where the hues are not. -->
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
			<!-- Decisions made before attribution existed or by the blacklist auto-reject.
			     Shown so the bars above sum to the real totals. Not `pluralize`: it emits the
			     count itself, which printed "98 unattributed 98 decisions". -->
			<p class="mt-4 border-t border-border pt-3 text-xs text-foreground-tertiary">
				<span class="font-mono tabular-nums">{nf.format(unattributed.total)}</span>
				unattributed {unattributed.total === 1 ? 'decision' : 'decisions'} — recorded before attribution
				existed, or applied automatically.
			</p>
		{/if}
	{/if}
</Card>
