<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import ApplicationResponses from './ApplicationResponses.svelte';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import { effectiveDecision } from '$lib/admissions/decision';
	import { Badge, Button, Checkbox, Modal } from '$lib/components/ui';
	import { ConfirmDialog, DataTable } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import type { Tone } from '$lib/ui/tone';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { DecisionStatus } from '$lib/generated/prisma/enums';
	import { humanizeEnum, pluralize } from '$lib/format';
	import { APPLICANT_ROLES } from '$lib/admissions/roles';
	import RubricScoreModal from './RubricScoreModal.svelte';
	import { type RubricCriterion } from '$lib/admissions/rubric';

	type Applicant = {
		uid: string;
		name: string;
		email: string;
		role: string;
		score: number | null;
		scoreDelta: number | null;
		notes: string | null;
		scorer: { name: string } | null;
		pendingDecision: string | null;
		activeDecision: string | null;
		blacklistMatch: BlacklistMatch | null;
		rubricSelections: Array<{ criterionId: string; levelId: string }>;
		application: Array<{
			value: string;
			userId: string;
			questionId: string;
			question: { title: string; order: number; type: string };
		}>;
	};

	let {
		applicants,
		loading,
		deciding,
		releasingOne,
		unscoredCount,
		maxScoreFor,
		rubricForRole,
		onDecide,
		onClear,
		onReleaseOne,
		onRescore,
		onSaveRubricScore,
		onSelectionChange
	}: {
		/** Already ranked by the server; never reordered here. */
		applicants: Applicant[];
		loading: boolean;
		deciding: boolean;
		releasingOne: boolean;
		/** Per-role rubrics mean per-role maxes; each row shows its own scale. */
		maxScoreFor: (role: string) => number;
		rubricForRole: (role: string) => RubricCriterion[];
		/** Unscored applicants cannot appear here; the count is shown so the list is not mistaken for complete. */
		unscoredCount: number;
		onDecide: (uids: string[], decision: DecisionStatus) => void;
		onClear: (uid: string) => void;
		/** Releases and emails immediately. */
		onReleaseOne: (uid: string) => void;
		/** Sends the applicant back to the review pane for a fresh score. */
		onRescore: (uid: string) => void;
		/** Rescores inline via the rubric modal; resolves on success, rejects on failure. */
		onSaveRubricScore: (
			uid: string,
			selections: Array<{ criterionId: string; levelId: string }>,
			delta: number
		) => Promise<void>;
		/** Fires whenever the checkbox selection changes; used by the parent for "Release Selected". */
		onSelectionChange?: (uids: string[]) => void;
	} = $props();

	let selected = new SvelteSet<string>();
	/** Number, not string: `bind:value` on a number input coerces. */
	let topN = $state<number | undefined>(undefined);
	let open = $state<Applicant | null>(null);

	/** Bulk action awaiting confirmation. */
	let pending = $state<DecisionStatus | null>(null);

	let releaseTarget = $state<(typeof rows)[number] | null>(null);

	let rescoreTarget = $state<Applicant | null>(null);
	let rescoreOpen = $state(false);
	let rescoreSelections = $state<Record<string, string | undefined>>({});
	let rescoreDelta = $state<number | undefined>(0);
	let rescoreSaving = $state(false);

	function openRescore(applicant: Applicant) {
		rescoreTarget = applicant;
		rescoreSelections = Object.fromEntries(
			applicant.rubricSelections.map((s) => [s.criterionId, s.levelId])
		);
		rescoreDelta = applicant.scoreDelta ?? 0;
		rescoreOpen = true;
	}

	async function saveRescore() {
		if (!rescoreTarget) return;
		const criteria = rubricForRole(rescoreTarget.role);
		rescoreSaving = true;
		try {
			await onSaveRubricScore(
				rescoreTarget.uid,
				criteria.map((c) => ({ criterionId: c.id, levelId: rescoreSelections[c.id] as string })),
				rescoreDelta ?? 0
			);
			rescoreOpen = false;
			rescoreTarget = null;
		} finally {
			rescoreSaving = false;
		}
	}

	let roleFilter = $state<string | null>(null);

	// Fixed to APPLICANT_ROLES so tabs don't disappear when server-side filters narrow the results.
	const availableRoles = APPLICANT_ROLES;

	// Rank is a property of position in the visible list, not of the applicant: with
	// per-role maxes, cross-role raw scores aren't comparable, so a role tab re-ranks
	// within that role rather than showing global positions full of gaps.
	let rows = $derived(
		applicants
			.filter((a) => !roleFilter || a.role === roleFilter)
			.map((applicant, i) => ({ ...applicant, rank: i + 1 }))
	);
	type Row = (typeof rows)[number];

	let allSelected = $derived(rows.length > 0 && selected.size === rows.length);

	// Prunes uids no longer visible — dropped by a refetch or hidden by the role tab —
	// so a bulk action can never touch rows the operator can't see.
	$effect(() => {
		const present = new Set(rows.map((a) => a.uid));
		for (const uid of selected) if (!present.has(uid)) selected.delete(uid);
	});

	$effect(() => {
		onSelectionChange?.([...selected]);
	});

	let lastToggledIdx = $state<number | null>(null);

	function toggle(uid: string, index: number, shiftKey = false) {
		if (shiftKey && lastToggledIdx !== null) {
			const start = Math.min(lastToggledIdx, index);
			const end = Math.max(lastToggledIdx, index);
			// Apply the same action as what's happening to the clicked item.
			const add = !selected.has(uid);
			for (let i = start; i <= end; i++) {
				if (add) selected.add(rows[i].uid);
				else selected.delete(rows[i].uid);
			}
		} else {
			if (selected.has(uid)) selected.delete(uid);
			else selected.add(uid);
		}
		lastToggledIdx = index;
	}

	function toggleAll() {
		if (allSelected) selected.clear();
		else for (const row of rows) selected.add(row.uid);
	}

	// Selects, never decides: one keystroke touching an unbounded number of people lands
	// the operator in front of a selection they can adjust.
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

	// Pressing the already-pending decision clears it.
	function decideOne(uid: string, decision: DecisionStatus) {
		const row = rows.find((r) => r.uid === uid);
		if (row?.pendingDecision === decision) {
			onClear(uid);
		} else {
			onDecide([uid], decision);
		}
	}

	function confirmReleaseOne() {
		const uid = releaseTarget?.uid;
		releaseTarget = null;
		if (uid) onReleaseOne(uid);
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
		{ key: 'actions', header: '', width: 'w-64', align: 'right' },
		{ key: 'release', header: '', width: 'w-24', align: 'right' }
	];
</script>

<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
	<div class="flex items-center gap-1">
		<button
			type="button"
			onclick={() => (roleFilter = null)}
			class="rounded px-2 py-0.5 text-xs font-medium transition-colors
				       {roleFilter === null ? 'bg-primary text-white' : 'text-foreground-secondary hover:bg-muted'}"
		>
			All
		</button>
		{#each availableRoles as role (role)}
			<button
				type="button"
				onclick={() => (roleFilter = roleFilter === role ? null : role)}
				class="rounded px-2 py-0.5 text-xs font-medium transition-colors
					       {roleFilter === role ? 'bg-primary text-white' : 'text-foreground-secondary hover:bg-muted'}"
			>
				{humanizeEnum(role)}
			</button>
		{/each}
	</div>

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
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div onclick={(e) => toggle(row.uid, row.rank - 1, e.shiftKey)}>
				<Checkbox
					checked={selected.has(row.uid)}
					onCheckedChange={() => {}}
					aria-label="Select {row.name}"
				/>
			</div>
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
			{@const hasRubric = rubricForRole(row.role).length > 0}
			{#if hasRubric}
				<button
					type="button"
					onclick={() => openRescore(row)}
					title="Click to rescore"
					class="cursor-pointer border-none bg-transparent p-0 font-mono text-base font-medium
					       tabular-nums underline-offset-2 hover:underline focus-visible:shadow-ring"
				>
					{row.score ?? '—'}<span class="text-2xs font-normal text-foreground-tertiary"
						>/{maxScoreFor(row.role)}</span
					>
				</button>
			{:else}
				<span class="font-mono text-base font-medium tabular-nums">
					{row.score ?? '—'}<span class="text-2xs font-normal text-foreground-tertiary"
						>/{maxScoreFor(row.role)}</span
					>
				</span>
			{/if}
		{:else if column.key === 'notes'}
			{#if row.notes}
				<!-- Clamped so the score and decision stay on screen together; full text on hover. -->
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
			{@const isActive = (d: string) => row.pendingDecision === d}
			<div class="flex justify-end gap-1.5">
				<Button
					size="sm"
					class="w-20"
					variant={isActive('ACCEPTED') ? 'secondary' : 'primary'}
					disabled={deciding}
					onclick={() => decideOne(row.uid, 'ACCEPTED')}
				>
					{isActive('ACCEPTED') ? 'Undo' : 'Accept'}
				</Button>
				<Button
					size="sm"
					class={isActive('WAITLISTED')
						? 'w-20'
						: 'w-20 border-transparent bg-warning-500 font-semibold text-white hover:bg-warning-700 active:bg-warning-700'}
					disabled={deciding}
					onclick={() => decideOne(row.uid, 'WAITLISTED')}
				>
					{isActive('WAITLISTED') ? 'Undo' : 'Waitlist'}
				</Button>
				<Button
					size="sm"
					class="w-20"
					variant={isActive('REJECTED') ? 'secondary' : 'danger'}
					disabled={deciding}
					onclick={() => decideOne(row.uid, 'REJECTED')}
				>
					{isActive('REJECTED') ? 'Undo' : 'Reject'}
				</Button>
			</div>
		{:else if column.key === 'release'}
			{@const hasPending = row.pendingDecision !== null && row.pendingDecision !== 'PENDING'}
			{@const isReleased = Boolean(row.activeDecision)}
			<Button
				size="sm"
				disabled={isReleased || !hasPending || releasingOne || deciding}
				onclick={() => (releaseTarget = row)}
			>
				{isReleased ? 'Released' : 'Release'}
			</Button>
		{/if}
	{/snippet}
</DataTable>

<RubricScoreModal
	bind:open={rescoreOpen}
	criteria={rescoreTarget ? rubricForRole(rescoreTarget.role) : []}
	bind:selections={rescoreSelections}
	bind:delta={rescoreDelta}
	saving={rescoreSaving}
	onSave={saveRescore}
/>

<!-- No typed phrase: a pending decision is reversible until Release, which has its own gate. -->
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

<ConfirmDialog
	open={releaseTarget !== null}
	title="Release decision for {releaseTarget?.name ?? ''}?"
	description="This will immediately email {releaseTarget?.name} their {releaseTarget?.pendingDecision
		? humanizeEnum(releaseTarget.pendingDecision)
		: ''} decision. This cannot be undone."
	confirmLabel="Release"
	tone="primary"
	loading={releasingOne}
	onConfirm={confirmReleaseOne}
	onCancel={() => (releaseTarget = null)}
/>

<!-- Rows already carry their answers, so this costs no extra request. -->
<Modal
	open={open !== null}
	title={open?.name ?? ''}
	description={open?.email}
	size="lg"
	onClose={() => (open = null)}
>
	{#if open}
		<div class="mb-5 flex flex-wrap items-center gap-2">
			<Badge tone="info">{open.score}/{maxScoreFor(open.role)}</Badge>
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
				class="mr-auto"
				disabled={deciding}
				onclick={() => {
					onRescore(applicant.uid);
					open = null;
				}}
			>
				Rescore
			</Button>
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
