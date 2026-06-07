<script lang="ts">
	let {
		entries
	}: {
		entries: Array<{
			id: string;
			action: string;
			timestamp: Date | string;
			user: { name: string; email: string } | null;
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

	const NOTABLE = ['release', 'scan', 'submit', 'confirm', 'accept', 'reject', 'waitlist'];

	function isNotable(action: string): boolean {
		return NOTABLE.some((kw) => action.toLowerCase().includes(kw));
	}
</script>

<div class="bg-white border border-border rounded-md px-6 py-5 h-full flex flex-col">
	<div class="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-4 shrink-0">
		Recent Activity
	</div>

	{#if entries.length === 0}
		<div class="text-[13px] text-muted-foreground text-center py-6">
			No activity yet
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto">
			{#each entries as entry}
				<div class="flex items-start gap-[10px] py-[10px] border-b border-[#f0f0f0]">
					<div
						class="size-1.5 shrink-0 mt-1 rounded-full"
						style="background:{isNotable(entry.action) ? '#191919' : '#cccccc'}"
					></div>
					<div class="flex-1 min-w-0">
						<div class="text-[13px] text-[#333] leading-[1.4]">
							{#if entry.user}
								<span class="font-medium">{entry.user.name}</span>
							{/if}
							{entry.action}
						</div>
					</div>
					<div class="text-[11px] text-muted-foreground shrink-0 font-mono">
						{formatRelative(entry.timestamp)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
