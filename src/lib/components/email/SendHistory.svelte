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

<div class="rounded-md border border-border bg-card">
	<div class="flex items-center justify-between border-b border-border bg-muted px-4 py-2.5">
		<span
			class="font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
		>
			Recent Sends
		</span>
		<span class="text-xs text-foreground-secondary">
			Records what was sent, not who sent it or by what filter.
		</span>
	</div>

	{#if logs.length === 0}
		<div class="px-4 py-6 text-center text-xs text-foreground-secondary">Nothing sent yet.</div>
	{:else}
		<table class="w-full text-base">
			<thead>
				<tr class="border-b border-border text-left">
					<th
						class="px-4 py-2 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Subject
					</th>
					<th
						class="w-28 px-4 py-2 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Recipients
					</th>
					<th
						class="w-48 px-4 py-2 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
					>
						Sent
					</th>
				</tr>
			</thead>
			<tbody>
				{#each logs as log (log.id)}
					<tr class="border-b border-border last:border-b-0">
						<td class="max-w-0 truncate px-4 py-2 text-foreground" title={log.subject}>
							{log.subject}
						</td>
						<td class="px-4 py-2 font-mono text-sm text-foreground">{log.userIds.length}</td>
						<td class="px-4 py-2 font-mono text-sm text-foreground-secondary">
							{new Date(log.sentAt).toLocaleString()}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
