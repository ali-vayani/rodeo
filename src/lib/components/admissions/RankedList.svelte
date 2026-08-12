<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import ApplicationResponses from './ApplicationResponses.svelte';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import { MAX_SCORE } from '$lib/admissions/score';
	import { effectiveDecision } from '$lib/admissions/decision';
	import { Badge, Button, Checkbox, Modal } from '$lib/components/ui';
	import { ConfirmDialog, DataTable } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import type { Tone } from '$lib/ui/tone';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { DecisionStatus } from '$lib/generated/prisma/enums';
	import { humanizeEnum, pluralize } from '$lib/format';

	type Applicant = {
		uid: string;
		name: string;
		email: string;
		role: string;
		score: number | null;
		notes: string | null;
		scorer: { name: string } | null;
		pendingDecision: string | null;
		activeDecision: string | null;
		blacklistMatch: BlacklistMatch | null;
		application: Array<{ value: string; question: { title: string; order: number } }>;
	};

	let {
		applicants,
		loading,
		deciding,
		unscoredCount,
		onDecide
	}: {
		/** Already ranked by the server — this component never reorders. */
		applicants: Applicant[];
		loading: boolean;
		deciding: boolean;
		/** Applicants with no score yet, which by definition can't appear here. */
		unscoredCount: number;
		onDecide: (uids: string[], decision: DecisionStatus) => void;
	} = $props();

	let selected = new SvelteSet<string>();
	/** Number, not string — `bind:value` on a number input coerces. */
	let topN = $state<number | undefined>(undefined);
	let open = $state<Applicant | null>(null);

	/** The bulk action awaiting confirmation. */
	let pending = $state<DecisionStatus | null>(null);

	// Rank is assigned here rather than read off the row because it is a property
	// of position in this list, not of the applicant — and the table has no index.
	let rows = $derived(applicants.map((applicant, i) => ({ ...applicant, rank: i + 1 })));
	type Row = (typeof rows)[number];

	let allSelected = $derived(rows.length > 0 && selected.size === rows.length);

	// Selection survives a refetch by uid, so anyone who dropped out of the list is
	// pruned before a bulk action can carry a stale uid to the server.
	$effect(() => {
		const present = new Set(applicants.map((a) => a.uid));
		for (const uid of selected) if (!present.has(uid)) selected.delete(uid);
	});

	function toggle(uid: string) {
		if (selected.has(uid)) selected.delete(uid);
		else selected.add(uid);
	}

	function toggleAll() {
		if (allSelected) selected.clear();
		else for (const row of rows) selected.add(row.uid);
	}

	/**
	 * Select — never decide — the top N.
	 *
	 * The cutoff is the one action here that touches an unbounded number of people
	 * from a single keystroke, so it lands the operator in front of a selection
	 * they can see and adjust rather than firing the decision itself.
	 */
	function selectTop() {
		if (topN === undefined || !Number.isInteger(topN) || topN < 1) return;
		selected.clear();
		for (const row of rows.slice(0, topN)) selected.add(row.uid);
	}

	function confirmBulk() {
		const decision = pending;
		pending = null;
		if (decision) onDecide([...selected], decision);
	}

	function decideOne(uid: string, decision: DecisionStatus) {
		onDecide([uid], decision);
	}

	const DECISION_TONE: Record<string, Tone> = {
		ACCEPTED: 'success',
		WAITLISTED: 'warning',
		REJECTED: 'danger'
	};

	const columns: Column<Row>[] = [
		{ key: 'select', header: '', width: 'w-10' },
		{ key: 'rank', header: '#', width: 'w-12' },
		{ key: 'name', header: 'Applicant' },
		{ key: 'scorer', header: 'Scored by', width: 'w-32' },
		{ key: 'score', header: 'Score', width: 'w-20', align: 'right' },
		{ key: 'notes', header: 'Notes' },
		{ key: 'decision', header: 'Decision', width: 'w-28' },
		{ key: 'actions', header: '', width: 'w-56', align: 'right' }
	];
</script>

<!-- Toolbar: selection, the cutoff, and the bulk actions it feeds -->
<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
	<Button size="sm" onclick={toggleAll} disabled={rows.length === 0}>
		{allSelected ? 'Clear selection' : 'Select all'}
	</Button>

	<div class="flex items-center gap-1.5">
		<label for="top-n" class="text-xs text-foreground-secondary">Select top</label>
		<input
			id="top-n"
			type="number"
			min="1"
			max={rows.length}
			bind:value={topN}
			onkeydown={(e) => e.key === 'Enter' && selectTop()}
			class="w-20 rounded-md border border-border bg-card px-2 py-1 text-center font-mono
			       text-touch tabular-nums outline-none focus-visible:shadow-ring sm:text-xs"
		/>
		<Button size="sm" onclick={selectTop} disabled={topN === undefined}>Apply</Button>
	</div>

	{#if selected.size > 0}
		<div class="ml-auto flex flex-wrap items-center gap-2">
			<span class="font-mono text-2xs text-foreground-secondary tabular-nums">
				{pluralize(selected.size, 'selected', 'selected')}
			</span>
			<Button
				size="sm"
				variant="primary"
				disabled={deciding}
				onclick={() => (pending = 'ACCEPTED')}
			>
				Accept
			</Button>
			<Button size="sm" disabled={deciding} onclick={() => (pending = 'WAITLISTED')}>
				Waitlist
			</Button>
			<Button size="sm" variant="danger" disabled={deciding} onclick={() => (pending = 'REJECTED')}>
				Reject
			</Button>
		</div>
	{/if}
</div>

<!--
	The unscored are invisible here by construction — there is no rank to put them
	at. Saying so is what keeps "I worked the whole list" from being wrong.
-->
{#if unscoredCount > 0}
	<div
		class="mb-3 rounded-md border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-xs text-warning-700"
	>
		{pluralize(unscoredCount, 'applicant')} not scored yet — they are not in this list. Finish the Review
		pass to rank them.
	</div>
{/if}

<DataTable
	{columns}
	{rows}
	{loading}
	rowKey={(row) => row.uid}
	stickyHeader
	emptyMessage="No scored applicants yet. Score applications on the Review tab and they'll be ranked here."
>
	{#snippet cell({ row, column })}
		{#if column.key === 'select'}
			<Checkbox
				checked={selected.has(row.uid)}
				onCheckedChange={() => toggle(row.uid)}
				aria-label="Select {row.name}"
			/>
		{:else if column.key === 'rank'}
			<span class="font-mono text-2xs text-foreground-tertiary tabular-nums">{row.rank}</span>
		{:else if column.key === 'name'}
			<button
				type="button"
				onclick={() => (open = row)}
				class="flex cursor-pointer flex-col items-start gap-0.5 border-none bg-transparent p-0 text-left
				       focus-visible:shadow-ring"
			>
				<span class="flex items-center gap-1.5">
					<span class="font-medium text-foreground underline-offset-2 hover:underline">
						{row.name}
					</span>
					<BlacklistBadge match={row.blacklistMatch} />
				</span>
				<span class="text-2xs text-foreground-tertiary">{row.email}</span>
			</button>
		{:else if column.key === 'scorer'}
			{#if row.scorer}
				<span class="text-xs text-foreground-secondary">{row.scorer.name}</span>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'score'}
			<span class="font-mono text-base font-medium tabular-nums">{row.score}</span>
		{:else if column.key === 'notes'}
			{#if row.notes}
				<!-- Truncated with the full text on hover: the column has to stay narrow
				     enough that the score and the decision are on screen together. -->
				<span class="line-clamp-2 text-xs text-foreground-secondary" title={row.notes}>
					{row.notes}
				</span>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'decision'}
			{@const decision = effectiveDecision(row)}
			{#if decision}
				<Badge tone={DECISION_TONE[decision] ?? 'neutral'}>
					{humanizeEnum(decision)}
				</Badge>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'actions'}
			<div class="flex justify-end gap-1.5">
				<Button
					size="sm"
					variant="primary"
					disabled={deciding}
					onclick={() => decideOne(row.uid, 'ACCEPTED')}
				>
					Accept
				</Button>
				<Button size="sm" disabled={deciding} onclick={() => decideOne(row.uid, 'WAITLISTED')}>
					Waitlist
				</Button>
				<Button
					size="sm"
					variant="danger"
					disabled={deciding}
					onclick={() => decideOne(row.uid, 'REJECTED')}
				>
					Reject
				</Button>
			</div>
		{/if}
	{/snippet}
</DataTable>

<!-- Bulk confirmation. No typed phrase — a pending decision is reversible right
     up until Release, which has a gate of its own. -->
<ConfirmDialog
	open={pending !== null}
	title="Apply to {pluralize(selected.size, 'applicant')}?"
	description="This sets a pending decision. Nothing is emailed until you release decisions."
	confirmLabel="Set to {pending ? humanizeEnum(pending) : ''}"
	tone={pending === 'REJECTED' ? 'danger' : 'primary'}
	loading={deciding}
	onConfirm={confirmBulk}
	onCancel={() => (pending = null)}
/>

<!-- Read-only application, opened from the applicant's name. The rows already
     carry their answers, so this costs no extra request. -->
<Modal
	open={open !== null}
	title={open?.name ?? ''}
	description={open?.email}
	size="lg"
	onClose={() => (open = null)}
>
	{#if open}
		<div class="mb-5 flex flex-wrap items-center gap-2">
			<Badge tone="info">{open.score}/{MAX_SCORE}</Badge>
			<span class="text-2xs text-foreground-tertiary">
				{humanizeEnum(open.role)}{open.scorer ? ` · scored by ${open.scorer.name}` : ''}
			</span>
		</div>

		{#if open.notes}
			<div class="mb-5 rounded-md border border-border bg-muted px-3.5 py-3">
				<div class="mb-1 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
					Reviewer notes
				</div>
				<p class="m-0 text-base whitespace-pre-wrap text-foreground">{open.notes}</p>
			</div>
		{/if}

		<ApplicationResponses responses={open.application} />
	{/if}

	{#snippet footer()}
		{#if open}
			{@const applicant = open}
			<Button
				variant="primary"
				disabled={deciding}
				onclick={() => {
					decideOne(applicant.uid, 'ACCEPTED');
					open = null;
				}}
			>
				Accept
			</Button>
			<Button
				disabled={deciding}
				onclick={() => {
					decideOne(applicant.uid, 'WAITLISTED');
					open = null;
				}}
			>
				Waitlist
			</Button>
			<Button
				variant="danger"
				disabled={deciding}
				onclick={() => {
					decideOne(applicant.uid, 'REJECTED');
					open = null;
				}}
			>
				Reject
			</Button>
		{/if}
	{/snippet}
</Modal>
