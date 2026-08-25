<script lang="ts">
	type LogRow = {
		id: string;
		subject: string;
		body: string;
		userIds: string[];
		sentAt: Date;
		failed: string[];
		errors: unknown;
	};

	let { logs }: { logs: LogRow[] } = $props();

	/** Distinct failure reasons with counts, biggest first, for the cell tooltip.
	    A plain object, not a Map: it never outlives the call, and the lint rule
	    reads any Map in a component as reactive state wanting SvelteMap. */
	function failureReasons(log: LogRow): string {
		const counts: Record<string, number> = {};
		for (const message of Object.values((log.errors ?? {}) as Record<string, string>)) {
			counts[message] = (counts[message] ?? 0) + 1;
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([message, count]) => `${count}× ${message}`)
			.join('\n');
	}
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
		<!-- Data-dense reference table: scrolls sideways on narrow screens rather
		     than card-stacking. -->
		<div class="overflow-x-auto">
			<table class="w-full min-w-md text-base">
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
							class="w-24 px-4 py-2 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
						>
							Failed
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
							{#if log.failed.length > 0}
								<!-- Hover for the why: distinct error messages with counts. -->
								<td
									class="cursor-help px-4 py-2 font-mono text-sm text-destructive"
									title={failureReasons(log)}
								>
									{log.failed.length}
								</td>
							{:else}
								<td class="px-4 py-2 font-mono text-sm text-foreground-tertiary">—</td>
							{/if}
							<td class="px-4 py-2 font-mono text-sm text-foreground-secondary">
								{new Date(log.sentAt).toLocaleString()}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
