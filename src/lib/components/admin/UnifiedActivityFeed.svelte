<script lang="ts">
	import { EmptyState, SegmentedControl, Spinner } from '$lib/components/ui';
	import type { ActivityEntry } from '$lib/dashboard';
	import { formatRelativeTime } from '$lib/format';

	// Staff and applicant activity in one stream. See `dashboard.activity` for why
	// applicant rows are derived.
	let {
		entries,
		source = $bindable('all'),
		loading = false,
		onSourceChange
	}: {
		entries: ActivityEntry[];
		/** `ActivitySource | 'all'`, widened to `string` so it can bind to the control. */
		source?: string;
		loading?: boolean;
		onSourceChange?: (value: string) => void;
	} = $props();

	const SOURCES = [
		{ value: 'all', label: 'All' },
		{ value: 'admin', label: 'Admin' },
		{ value: 'hacker', label: 'Hacker' }
	];

	const TONES = {
		accepted: 'bg-success-50 border-success-200 text-success-700',
		rejected: 'bg-danger-50 border-danger-200 text-danger-700',
		waitlisted: 'bg-warning-50 border-warning-200 text-warning-700',
		neutral: 'bg-muted border-border text-foreground-secondary'
	} as const;

	const EMPTY_MESSAGE: Record<string, string> = {
		all: 'Decisions, emails, scans and new applications appear here as they happen.',
		admin: 'Decisions, emails and scans appear here as admins work through applications.',
		hacker: 'New applications and door scans appear here as they arrive.'
	};
</script>

<div class="flex h-full flex-col">
	<div class="mb-3 flex shrink-0 items-center justify-end">
		<SegmentedControl
			bind:value={source}
			options={SOURCES}
			size="sm"
			ariaLabel="Activity source"
			disabled={loading}
			onValueChange={(value) => onSourceChange?.(value)}
		/>
	</div>

	{#if loading}
		<div class="flex justify-center py-8"><Spinner /></div>
	{:else if entries.length === 0}
		<EmptyState compact title="No activity" message={EMPTY_MESSAGE[source] ?? EMPTY_MESSAGE.all} />
	{:else}
		<!-- Scrolls inside the card so the chart beside it sets the row height. `min-h-0`
		     is required or the flex child never shrinks below its content. -->
		<ul class="min-h-0 flex-1 overflow-y-auto">
			{#each entries as entry (entry.id)}
				<li class="flex items-start gap-2.5 border-b border-border-subtle py-2.5 last:border-b-0">
					<!-- Filled for notable entries. Shape, not colour: this dot is not a status. -->
					<span
						class="mt-1.5 size-1.5 shrink-0 rounded-full {entry.notable
							? 'bg-primary'
							: 'bg-neutral-300'}"
					></span>

					<div class="min-w-0 flex-1">
						<p class="text-base leading-snug text-foreground">
							{#if entry.actorName}<span class="font-semibold">{entry.actorName}</span>{/if}
							{entry.summary}
						</p>
						<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
							{#if entry.detail}
								<span class="rounded-sm border px-1.5 text-2xs font-semibold {TONES[entry.tone]}">
									{entry.detail}
								</span>
							{/if}
							<span class="text-2xs text-foreground-tertiary">
								{entry.source === 'admin' ? 'Admin action' : 'Hacker action'}
							</span>
						</div>
					</div>

					<span class="shrink-0 font-mono text-2xs text-foreground-tertiary">
						{formatRelativeTime(entry.timestamp)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
