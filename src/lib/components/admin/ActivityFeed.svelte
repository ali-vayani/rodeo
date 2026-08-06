<script lang="ts">
	import { NOTABLE_ACTIONS } from '$lib/log/notable';

	let {
		entries
	}: {
		entries: Array<{
			id: string;
			action: string;
			summary: string;
			timestamp: Date | string;
			actorName: string | null;
		}>;
	} = $props();

	function formatRelative(ts: Date | string): string {
		const now = Date.now();
		const then = new Date(ts).getTime();
		const diffMs = now - then;
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return `${diffSec}s ago`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		return `${diffDay}d ago`;
	}

	function isNotable(action: string): boolean {
		return NOTABLE_ACTIONS.has(action);
	}
</script>

<div class="flex h-full flex-col rounded-md border border-border bg-white p-4 sm:px-6 sm:py-5">
	<div
		class="mb-4 shrink-0 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
	>
		Recent Activity
	</div>

	{#if entries.length === 0}
		<div class="py-6 text-center text-[13px] text-muted-foreground">No activity yet</div>
	{:else}
		<!-- Below lg the feed is stacked in an auto-height row; cap it so the
		     page doesn't grow with every log entry. On lg+ the grid row
		     (stretched to the chart column) bounds it instead. -->
		<div class="max-h-96 flex-1 overflow-y-auto lg:max-h-none">
			{#each entries as entry (entry.id)}
				<div class="flex items-start gap-[10px] border-b border-[#f0f0f0] py-[10px]">
					<div
						class="mt-1 size-1.5 shrink-0 rounded-full"
						style="background:{isNotable(entry.action) ? '#191919' : '#cccccc'}"
					></div>
					<div class="min-w-0 flex-1">
						<div class="text-[13px] leading-[1.4] text-[#333]">
							{#if entry.actorName}
								<span class="font-medium">{entry.actorName}</span>
							{/if}
							{entry.summary}
						</div>
					</div>
					<div class="shrink-0 font-mono text-[11px] text-muted-foreground">
						{formatRelative(entry.timestamp)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
