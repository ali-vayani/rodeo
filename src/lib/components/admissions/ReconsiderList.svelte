<script lang="ts">
	import ApplicationResponses from './ApplicationResponses.svelte';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import { MAX_SCORE } from '$lib/admissions/score';
	import { Badge, Button, Modal } from '$lib/components/ui';
	import { DataTable } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import type { Tone } from '$lib/ui/tone';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { DecisionStatus } from '$lib/generated/prisma/enums';
	import { humanizeEnum } from '$lib/format';

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
		releasingOne,
		onDecide,
		onClear,
		onReleaseOne
	}: {
		applicants: Applicant[];
		loading: boolean;
		deciding: boolean;
		releasingOne: boolean;
		onDecide: (uids: string[], decision: DecisionStatus) => void;
		onClear: (uid: string) => void;
		onReleaseOne: (uid: string) => void;
	} = $props();

	let open = $state<Applicant | null>(null);
	let search = $state('');
	let roleFilter = $state<string | null>(null);

	/** Roles that actually appear in the list — don't show tabs for roles with no one. */
	let availableRoles = $derived([...new Set(applicants.map((a) => a.role))].sort());

	let filtered = $derived(
		applicants.filter((a) => {
			if (roleFilter && a.role !== roleFilter) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
			}
			return true;
		})
	);

	/**
	 * Toggle a decision on a single row. Pressing the already-pending decision clears it;
	 * pressing a different one sets it. Pressing one that matches the released active
	 * decision is a no-op, and the button is disabled at the template level anyway.
	 */
	function decideOne(uid: string, decision: DecisionStatus) {
		const row = applicants.find((a) => a.uid === uid);
		if (!row || row.activeDecision === decision) return;
		if (row.pendingDecision === decision) {
			onClear(uid);
		} else {
			onDecide([uid], decision);
		}
	}

	const DECISION_TONE: Record<string, Tone> = {
		ACCEPTED: 'success',
		WAITLISTED: 'warning',
		REJECTED: 'danger'
	};

	type Row = Applicant;

	const columns: Column<Row>[] = [
		{ key: 'name', header: 'Applicant' },
		{ key: 'role', header: 'Role', width: 'w-28' },
		{ key: 'released', header: 'Released', width: 'w-28' },
		{ key: 'pending', header: 'Pending', width: 'w-28' },
		{ key: 'score', header: 'Score', width: 'w-20', align: 'right' },
		{ key: 'actions', header: '', width: 'w-64', align: 'right' },
		{ key: 'release', header: '', width: 'w-24', align: 'right' }
	];
</script>

<!-- Toolbar: search and role filter -->
<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
	<input
		type="search"
		placeholder="Search by name or email…"
		bind:value={search}
		class="w-56 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground
		       outline-none placeholder:text-foreground-tertiary focus-visible:shadow-ring"
	/>

	{#if availableRoles.length > 1}
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
	{/if}
</div>

<DataTable
	{columns}
	rows={filtered}
	{loading}
	rowKey={(row) => row.uid}
	stickyHeader
	emptyMessage={applicants.length === 0
		? "No released decisions yet. Release decisions from the Decide tab and they'll appear here."
		: 'No applicants match your search.'}
>
	{#snippet cell({ row, column })}
		{#if column.key === 'name'}
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
		{:else if column.key === 'role'}
			<span class="text-xs text-foreground-secondary">{humanizeEnum(row.role)}</span>
		{:else if column.key === 'released'}
			{#if row.activeDecision}
				<Badge tone={DECISION_TONE[row.activeDecision] ?? 'neutral'}>
					{humanizeEnum(row.activeDecision)}
				</Badge>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'pending'}
			{@const pending =
				row.pendingDecision && row.pendingDecision !== 'PENDING' ? row.pendingDecision : null}
			{#if pending}
				<Badge tone={DECISION_TONE[pending] ?? 'neutral'}>
					{humanizeEnum(pending)}
				</Badge>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'score'}
			{#if row.score !== null}
				<span class="font-mono text-base font-medium tabular-nums">{row.score}</span>
			{:else}
				<span class="text-2xs text-foreground-tertiary">—</span>
			{/if}
		{:else if column.key === 'actions'}
			{@const isPending = (d: string) => row.pendingDecision === d}
			{@const isReleased = (d: string) => row.activeDecision === d}
			<div class="flex justify-end gap-1.5">
				<Button
					size="sm"
					class="w-20"
					variant={isPending('ACCEPTED') ? 'secondary' : 'primary'}
					disabled={isReleased('ACCEPTED') || deciding}
					onclick={() => decideOne(row.uid, 'ACCEPTED')}
				>
					{isPending('ACCEPTED') ? 'Undo' : 'Accept'}
				</Button>
				<Button
					size="sm"
					class={isPending('WAITLISTED')
						? 'w-20'
						: 'w-20 border-transparent bg-warning-500 font-semibold text-white hover:bg-warning-700 active:bg-warning-700'}
					disabled={isReleased('WAITLISTED') || deciding}
					onclick={() => decideOne(row.uid, 'WAITLISTED')}
				>
					{isPending('WAITLISTED') ? 'Undo' : 'Waitlist'}
				</Button>
				<Button
					size="sm"
					class="w-20"
					variant={isPending('REJECTED') ? 'secondary' : 'danger'}
					disabled={isReleased('REJECTED') || deciding}
					onclick={() => decideOne(row.uid, 'REJECTED')}
				>
					{isPending('REJECTED') ? 'Undo' : 'Reject'}
				</Button>
			</div>
		{:else if column.key === 'release'}
			{@const hasPending = row.pendingDecision !== null && row.pendingDecision !== 'PENDING'}
			<Button
				size="sm"
				disabled={!hasPending || releasingOne || deciding}
				onclick={() => onReleaseOne(row.uid)}
			>
				Release
			</Button>
		{/if}
	{/snippet}
</DataTable>

<!-- Read-only application modal, opened from the applicant's name. -->
<Modal
	open={open !== null}
	title={open?.name ?? ''}
	description={open?.email}
	size="lg"
	onClose={() => (open = null)}
>
	{#if open}
		<div class="mb-5 flex flex-wrap items-center gap-2">
			{#if open.score !== null}
				<Badge tone="info">{open.score}/{MAX_SCORE}</Badge>
			{/if}
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
				disabled={applicant.activeDecision === 'ACCEPTED' || deciding}
				onclick={() => {
					decideOne(applicant.uid, 'ACCEPTED');
					open = null;
				}}
			>
				Accept
			</Button>
			<Button
				disabled={applicant.activeDecision === 'WAITLISTED' || deciding}
				onclick={() => {
					decideOne(applicant.uid, 'WAITLISTED');
					open = null;
				}}
			>
				Waitlist
			</Button>
			<Button
				variant="danger"
				disabled={applicant.activeDecision === 'REJECTED' || deciding}
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
