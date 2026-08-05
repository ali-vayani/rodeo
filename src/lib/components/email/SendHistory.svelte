<script lang="ts">
	type LogRow = {
		id: string;
		subject: string;
		body: string;
		userIds: string[];
		sentAt: Date;
	};

	let { logs }: { logs: LogRow[] } = $props();
</script>

<div class="rounded-md border border-border bg-white">
	<div class="flex items-center justify-between border-b border-border bg-muted px-4 py-[9px]">
		<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Recent Sends
		</span>
		<span class="text-[11px] text-muted-foreground">
			Records what was sent, not who sent it or by what filter.
		</span>
	</div>

	{#if logs.length === 0}
		<div class="px-4 py-6 text-center text-xs text-muted-foreground">Nothing sent yet.</div>
	{:else}
		<table class="w-full text-[13px]">
			<thead>
				<tr class="border-b border-border text-left">
					<th
						class="px-4 py-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>
						Subject
					</th>
					<th
						class="w-[110px] px-4 py-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>
						Recipients
					</th>
					<th
						class="w-[190px] px-4 py-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>
						Sent
					</th>
				</tr>
			</thead>
			<tbody>
				{#each logs as log (log.id)}
					<tr class="border-b border-border last:border-b-0">
						<td class="max-w-0 truncate px-4 py-2 text-primary" title={log.subject}>
							{log.subject}
						</td>
						<td class="px-4 py-2 font-mono text-[12px] text-primary">{log.userIds.length}</td>
						<td class="px-4 py-2 font-mono text-[12px] text-muted-foreground">
							{new Date(log.sentAt).toLocaleString()}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
