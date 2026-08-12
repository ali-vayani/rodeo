<script lang="ts">
	import { DataTable, StatCard } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import { formatRelativeTime } from '$lib/format';

	type Reviewer = {
		uid: string;
		name: string;
		scored: number;
		lastScoredAt: Date | string | null;
	};

	let {
		reviewers,
		totalScored,
		totalApplicants,
		loading
	}: {
		reviewers: Reviewer[];
		totalScored: number;
		totalApplicants: number;
		loading: boolean;
	} = $props();

	const columns: Column<Reviewer>[] = [
		{ key: 'name', header: 'Reviewer' },
		{ key: 'scored', header: 'Scored', width: 'w-28', align: 'right' },
		{ key: 'lastScoredAt', header: 'Last scored', width: 'w-40', align: 'right' }
	];
</script>

<div class="space-y-5">
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<StatCard label="Scored" value={totalScored} />
		<StatCard label="Unscored" value={totalApplicants - totalScored} />
		<StatCard label="Reviewers" value={reviewers.length} />
	</div>

	<DataTable
		{columns}
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
</div>
