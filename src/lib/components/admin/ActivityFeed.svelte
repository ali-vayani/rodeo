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

<div
	style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:20px 24px; height:100%; display:flex; flex-direction:column;"
>
	<div
		style="font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#aaaaaa; margin-bottom:16px; flex-shrink:0;"
	>
		Recent Activity
	</div>

	{#if entries.length === 0}
		<div style="font-size:13px; color:#aaaaaa; text-align:center; padding:24px 0;">
			No activity yet
		</div>
	{:else}
		<div style="flex:1; overflow-y:auto;">
			{#each entries as entry}
				<div
					style="display:flex; align-items:flex-start; gap:10px; padding:10px 0; border-bottom:1px solid #f0f0f0;"
				>
					<div
						style="width:6px; height:6px; border-radius:50%; background:{isNotable(entry.action)
							? '#191919'
							: '#cccccc'}; flex-shrink:0; margin-top:4px;"
					></div>
					<div style="flex:1; min-width:0;">
						<div style="font-size:13px; color:#333; line-height:1.4;">
							{#if entry.user}
								<span style="font-weight:500;">{entry.user.name}</span>
							{/if}
							{entry.action}
						</div>
					</div>
					<div
						style="font-size:11px; color:#aaaaaa; flex-shrink:0; font-family:'DM Mono', monospace;"
					>
						{formatRelative(entry.timestamp)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
