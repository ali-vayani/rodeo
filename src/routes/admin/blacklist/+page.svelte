<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import { Badge, Button, IconButton, Input } from '$lib/components/ui';
	import { DataTable, PageHeader } from '$lib/components/patterns';
	import type { Column } from '$lib/components/ui/types';
	import DeleteEntryDialog from '$lib/components/blacklist/DeleteEntryDialog.svelte';
	import { parseBlacklistCsv } from '$lib/blacklist/csv';
	import { toast } from '$lib/ui/toast.svelte';
	import { formatDate, pluralize } from '$lib/format';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Entry = (typeof data.entries)[number];

	let entries = $state<Entry[]>(untrack(() => [...data.entries]));

	// --- Add form ---
	let addFirstName = $state('');
	let addLastName = $state('');
	let addEmail = $state('');
	let addReason = $state('');
	let adding = $state(false);

	// Email is optional -- a name-only entry still flags at review time -- so only the two
	// name fields gate the button.
	const canAdd = $derived(Boolean(addFirstName.trim() && addLastName.trim()) && !adding);

	async function addEntry() {
		if (!canAdd) return;

		adding = true;
		try {
			const entry = await trpc.blacklist.add.mutate({
				firstName: addFirstName.trim(),
				lastName: addLastName.trim(),
				email: addEmail.trim() || undefined,
				reason: addReason.trim() || undefined
			});

			// `add` upserts on email, so an existing address comes back edited rather than new.
			entries = [entry, ...entries.filter((e) => e.id !== entry.id)];
			addFirstName = '';
			addLastName = '';
			addEmail = '';
			addReason = '';
			toast.success('Entry added');
		} catch (e) {
			toast.fromError(e, 'Failed to add entry');
		} finally {
			adding = false;
		}
	}

	function onAddKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') addEntry();
	}

	// --- Remove ---
	/** Entry awaiting confirmation. Non-null is what puts the dialog on screen. */
	let pendingDelete = $state<Entry | null>(null);
	let deleting = $state(false);

	async function confirmRemove() {
		const entry = pendingDelete;
		if (!entry) return;

		deleting = true;
		try {
			await trpc.blacklist.remove.mutate({ id: entry.id });
			entries = entries.filter((e) => e.id !== entry.id);
			pendingDelete = null;
			toast.success('Entry removed');
		} catch (e) {
			toast.fromError(e, 'Failed to remove entry');
		} finally {
			deleting = false;
		}
	}

	// --- Search ---
	let search = $state('');

	const filtered = $derived.by(() => {
		const term = search.trim().toLowerCase();
		if (!term) return entries;

		return entries.filter((e) =>
			`${e.firstName} ${e.lastName} ${e.email ?? ''}`.toLowerCase().includes(term)
		);
	});

	// --- CSV import ---
	let importing = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function onFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset immediately so re-picking the same file after a fix still fires a change event.
		input.value = '';
		if (!file) return;

		const rows = parseBlacklistCsv(await file.text());
		if (!rows.length) {
			toast.error('No rows found in that file');
			return;
		}

		importing = true;
		try {
			const result = await trpc.blacklist.addBulk.mutate({ rows });
			entries = await trpc.blacklist.list.query();

			// Report what the server actually did. Counting the rows we sent would call every
			// skipped duplicate and rejected row a success.
			const parts = [`Added ${result.added}`];
			if (result.duplicates) parts.push(`${result.duplicates} already listed`);
			if (result.invalid.length) parts.push(`${result.invalid.length} invalid`);

			const summary = parts.join(' · ');
			if (result.invalid.length) toast.error(summary);
			else toast.success(summary);

			importErrors = result.invalid;
		} catch (e) {
			toast.fromError(e, 'Import failed');
		} finally {
			importing = false;
		}
	}

	/** Rejected rows from the last import, kept on screen so they can actually be fixed. */
	let importErrors = $state<{ row: number; reason: string }[]>([]);

	// --- Table ---
	const COLUMNS: Column<Entry>[] = [
		{ key: 'name', header: 'Name', nowrap: true },
		{ key: 'email', header: 'Email' },
		{ key: 'reason', header: 'Reason' },
		{ key: 'createdAt', header: 'Added', nowrap: true },
		{ key: 'actions', header: '', nowrap: true, align: 'right' }
	];
</script>

<PageHeader title="Blacklist">
	{#snippet description()}
		A matching <span class="font-medium text-foreground">email</span> auto-rejects on submit; a
		matching <span class="font-medium text-foreground">name</span> only flags the applicant for review.
	{/snippet}
	{#snippet meta()}{pluralize(entries.length, 'entry', 'entries')}{/snippet}
</PageHeader>

<div class="flex flex-col gap-4">
	<!-- Add form -->
	<div class="grid grid-cols-[1fr_1fr_1.2fr_1.4fr_auto] gap-2">
		<Input
			bind:value={addFirstName}
			placeholder="first name *"
			mono
			onkeydown={onAddKeydown}
			aria-label="First name"
		/>
		<Input
			bind:value={addLastName}
			placeholder="last name *"
			mono
			onkeydown={onAddKeydown}
			aria-label="Last name"
		/>
		<Input
			bind:value={addEmail}
			type="email"
			placeholder="email (preferred)"
			mono
			onkeydown={onAddKeydown}
			aria-label="Email"
		/>
		<Input
			bind:value={addReason}
			placeholder="reason (optional)"
			mono
			onkeydown={onAddKeydown}
			aria-label="Reason"
		/>
		<Button onclick={addEntry} disabled={!canAdd} loading={adding}>+ Add</Button>
	</div>

	<!-- Toolbar -->
	<div class="flex items-center gap-2">
		<Input bind:value={search} placeholder="search by name or email…" mono aria-label="Search" />
		<input
			bind:this={fileInput}
			type="file"
			accept=".csv,text/csv"
			onchange={onFileSelected}
			class="hidden"
		/>
		<Button
			onclick={() => fileInput?.click()}
			loading={importing}
			class="shrink-0"
			title="CSV columns: firstName, lastName, email, reason"
		>
			↑ Import CSV
		</Button>
	</div>

	<!-- Rows the last import refused, listed so they can be corrected rather than guessed at -->
	{#if importErrors.length}
		<div class="rounded-lg border border-warning-200 bg-warning-50 px-3.5 py-3">
			<div class="flex items-start justify-between gap-3">
				<div class="text-sm text-warning-700">
					<span class="font-semibold">{pluralize(importErrors.length, 'row')} skipped:</span>
					<ul class="mt-1 list-none space-y-0.5 pl-0 font-mono text-xs">
						{#each importErrors.slice(0, 8) as issue (issue.row)}
							<li>row {issue.row} — {issue.reason}</li>
						{/each}
						{#if importErrors.length > 8}
							<li class="opacity-70">…and {importErrors.length - 8} more</li>
						{/if}
					</ul>
				</div>
				<IconButton label="Dismiss import errors" size="sm" onclick={() => (importErrors = [])}>
					✕
				</IconButton>
			</div>
		</div>
	{/if}

	<DataTable
		columns={COLUMNS}
		rows={filtered}
		rowKey={(entry) => entry.id}
		stickyHeader
		scrollClass="workspace-max-h"
		emptyMessage={search.trim() ? 'No matching entries' : 'No entries yet'}
	>
		{#snippet cell({ row, column })}
			{#if column.key === 'name'}
				<span class="font-medium">{row.firstName} {row.lastName}</span>
			{:else if column.key === 'email'}
				{#if row.email}
					<span class="font-mono text-sm">{row.email}</span>
				{:else}
					<Badge tone="neutral">name only</Badge>
				{/if}
			{:else if column.key === 'reason'}
				<span class="text-sm text-foreground-secondary">{row.reason ?? '—'}</span>
			{:else if column.key === 'createdAt'}
				<span class="font-mono text-xs text-foreground-tertiary tabular-nums">
					{formatDate(row.createdAt)}
				</span>
			{:else if column.key === 'actions'}
				<IconButton
					label="Remove {row.firstName} {row.lastName}"
					size="sm"
					variant="danger"
					onclick={() => (pendingDelete = row)}
				>
					✕
				</IconButton>
			{/if}
		{/snippet}
	</DataTable>
</div>

{#if pendingDelete}
	<DeleteEntryDialog
		open
		entry={pendingDelete}
		isDeleting={deleting}
		onConfirm={confirmRemove}
		onCancel={() => (pendingDelete = null)}
	/>
{/if}
