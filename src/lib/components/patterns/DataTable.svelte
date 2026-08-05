<script lang="ts" generics="Row">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import type { Column } from '$lib/components/ui/types';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	let {
		columns,
		rows,
		rowKey,
		emptyMessage = 'Nothing here yet.',
		loading = false,
		stickyHeader = false,
		onRowClick = undefined,
		class: className = '',
		scrollClass = '',
		cell,
		empty
	}: {
		columns: Column<Row>[];
		rows: Row[];
		/** Stable identity for keyed each — never the array index. */
		rowKey: (row: Row) => string | number;
		emptyMessage?: string;
		/** Dims the body rather than blanking it, so the table doesn't jump. */
		loading?: boolean;
		stickyHeader?: boolean;
		onRowClick?: (row: Row) => void;
		class?: string;
		/** Height constraint for the scroll region, e.g. `workspace-max-h`. */
		scrollClass?: string;
		/** Custom cell rendering. Falls back to `column.value(row)`. */
		cell?: Snippet<[{ row: Row; column: Column<Row> }]>;
		empty?: Snippet;
	} = $props();

	const CELL = 'px-3.5 text-base';
</script>

<!--
	Replaces four tables written in four styles — one of which, UserTable.svelte,
	was dead code that routes/admin/users duplicated inline.
-->
<div class={cn('overflow-hidden rounded-lg border border-border bg-card shadow-sm', className)}>
	<div class={cn('overflow-x-auto', scrollClass, loading && 'opacity-50 transition-opacity')}>
		{#if rows.length === 0}
			{#if empty}
				{@render empty()}
			{:else}
				<EmptyState message={emptyMessage} />
			{/if}
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class={cn('border-b border-border bg-muted', stickyHeader && 'sticky top-0 z-1')}>
						{#each columns as column (column.key)}
							<th
								scope="col"
								class={cn(
									CELL,
									'bg-muted py-2 font-mono text-2xs font-medium tracking-eyebrow whitespace-nowrap',
									'text-foreground-tertiary uppercase',
									column.align === 'right' ? 'text-right' : 'text-left',
									column.width
								)}
							>
								{column.header}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (rowKey(row))}
						<tr
							class={cn(
								'border-b border-border-subtle transition-colors duration-150 last:border-b-0',
								onRowClick ? 'cursor-pointer hover:bg-surface-hover' : 'hover:bg-surface-hover'
							)}
							onclick={onRowClick ? () => onRowClick(row) : undefined}
						>
							{#each columns as column (column.key)}
								<td
									class={cn(
										CELL,
										'h-9 py-2',
										column.align === 'right' && 'text-right',
										column.nowrap && 'whitespace-nowrap'
									)}
								>
									{#if cell}
										{@render cell({ row, column })}
									{:else}
										{column.value?.(row) ?? ''}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
