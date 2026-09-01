<script lang="ts">
	import { DataTable, StatCard } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import { formatRelativeTime, humanizeEnum } from '$lib/format';

	type Reviewer = {
		uid: string;
		name: string;
		scored: number;
		lastScoredAt: Date | string | null;
	};

	type RoleRow = {
		role: string;
		total: number;
		accepted: number;
		waitlisted: number;
		rejected: number;
		undecided: number;
	};

	type DecisionStats = {
		byRole: RoleRow[];
		scores: { avg: number | null; min: number | null; max: number | null; count: number };
	} | null;

	type Stats = {
		accepted: number;
		waitlisted: number;
		rejected: number;
		undecided: number;
		scored: number;
		pending: number;
	};

	let {
		reviewers,
		loading,
		stats,
		decisionStats,
		maxScore
	}: {
		reviewers: Reviewer[];
		loading: boolean;
		stats: Stats;
		decisionStats: DecisionStats;
		maxScore: number;
	} = $props();

	const totalApplicants = $derived(
		stats.accepted + stats.waitlisted + stats.rejected + stats.undecided
	);

	const pctScored = $derived(
		totalApplicants > 0 ? Math.round((stats.scored / totalApplicants) * 100) : 0
	);

	const reviewerColumns: Column<Reviewer>[] = [
		{ key: 'name', header: 'Reviewer' },
		{ key: 'scored', header: 'Scored', width: 'w-28', align: 'right' },
		{ key: 'lastScoredAt', header: 'Last scored', width: 'w-40', align: 'right' }
	];

	const roleColumns: Column<RoleRow>[] = [
		{ key: 'role', header: 'Role' },
		{ key: 'total', header: 'Total', width: 'w-20', align: 'right' },
		{ key: 'accepted', header: 'Accepted', width: 'w-24', align: 'right' },
		{ key: 'waitlisted', header: 'Waitlisted', width: 'w-24', align: 'right' },
		{ key: 'rejected', header: 'Rejected', width: 'w-24', align: 'right' },
		{ key: 'undecided', header: 'Undecided', width: 'w-24', align: 'right' }
	];
</script>

<div class="space-y-8">
	<section>
		<h2 class="mb-3 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			Decisions
		</h2>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<StatCard label="Accepted" value={stats.accepted} tone="success" />
			<StatCard label="Waitlisted" value={stats.waitlisted} tone="warning" />
			<StatCard label="Rejected" value={stats.rejected} tone="danger" />
			<StatCard label="Undecided" value={stats.undecided} />
		</div>
		{#if stats.pending > 0}
			<p class="mt-2 text-xs text-foreground-secondary">
				{stats.pending} pending decision{stats.pending === 1 ? '' : 's'} not yet released
			</p>
		{/if}
	</section>

	<section>
		<h2 class="mb-3 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			By role
		</h2>
		<DataTable
			columns={roleColumns}
			rows={decisionStats?.byRole ?? []}
			loading={loading && !decisionStats}
			rowKey={(r) => r.role}
			emptyMessage="No applicants yet."
		>
			{#snippet cell({ row, column })}
				{#if column.key === 'role'}
					<span class="font-medium text-foreground">{humanizeEnum(row.role)}</span>
				{:else if column.key === 'total'}
					<span class="font-mono tabular-nums">{row.total}</span>
				{:else if column.key === 'accepted'}
					<span class="font-mono text-success-700 tabular-nums">{row.accepted}</span>
				{:else if column.key === 'waitlisted'}
					<span class="font-mono text-warning-700 tabular-nums">{row.waitlisted}</span>
				{:else if column.key === 'rejected'}
					<span class="font-mono text-danger-700 tabular-nums">{row.rejected}</span>
				{:else if column.key === 'undecided'}
					<span class="font-mono text-foreground-secondary tabular-nums">{row.undecided}</span>
				{/if}
			{/snippet}
		</DataTable>
	</section>

	<section>
		<h2 class="mb-3 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			Scoring
		</h2>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<StatCard label="Scored" value={stats.scored} hint="of {totalApplicants} total" />
			<StatCard label="% Scored" value="{pctScored}%" />
			<StatCard
				label="Avg score"
				value={decisionStats?.scores.avg !== null && decisionStats?.scores.avg !== undefined
					? decisionStats.scores.avg
					: '—'}
				hint="out of {maxScore}"
			/>
			<StatCard
				label="Range"
				value={decisionStats?.scores.min !== null && decisionStats?.scores.min !== undefined
					? `${decisionStats.scores.min}–${decisionStats.scores.max}`
					: '—'}
				hint="min – max"
			/>
		</div>
	</section>

	<section>
		<h2 class="mb-3 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			Reviewers
		</h2>
		<DataTable
			columns={reviewerColumns}
			rows={reviewers}
			{loading}
			rowKey={(r) => r.uid}
			emptyMessage="No applications have been scored yet."
		>
			{#snippet cell({ row, column })}
				{#if column.key === 'name'}
					<span class="font-medium text-foreground">{row.name}</span>
				{:else if column.key === 'scored'}
					<span class="font-mono tabular-nums">{row.scored}</span>
				{:else if column.key === 'lastScoredAt'}
					{#if row.lastScoredAt}
						<span class="text-xs text-foreground-secondary">
							{formatRelativeTime(row.lastScoredAt)}
						</span>
					{:else}
						<span class="text-2xs text-foreground-tertiary">—</span>
					{/if}
				{/if}
			{/snippet}
		</DataTable>
	</section>
</div>
