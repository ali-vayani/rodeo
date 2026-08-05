<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import Toast from '$lib/components/ui/Toast.svelte';
	import DeleteEntryDialog from '$lib/components/blacklist/DeleteEntryDialog.svelte';
	import { parseBlacklistCsv } from '$lib/blacklist/csv';

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
			showToast('Entry added');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to add entry'), 'error');
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
			showToast('Entry removed');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to remove entry'), 'error');
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
			showToast('No rows found in that file', 'error');
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

			showToast(parts.join(' · '), result.invalid.length ? 'error' : 'success');
			importErrors = result.invalid;
		} catch (e) {
			showToast(errorMessage(e, 'Import failed'), 'error');
		} finally {
			importing = false;
		}
	}

	/** Rejected rows from the last import, kept on screen so they can actually be fixed. */
	let importErrors = $state<{ row: number; reason: string }[]>([]);

	// --- Helpers ---
	function errorMessage(error: unknown, fallback: string): string {
		return error instanceof Error && error.message ? error.message : fallback;
	}

	function formatDate(value: Date | string): string {
		return new Date(value).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// --- Toast ---
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3600);
	}
</script>

<div class="mb-4 flex items-start justify-between gap-4">
	<div>
		<h1 class="text-[22px] font-bold text-primary">Blacklist</h1>
		<span class="mt-0.5 block text-[13px] text-muted-foreground">
			A matching <span class="font-medium text-primary">email</span> auto-rejects on submit; a
			matching <span class="font-medium text-primary">name</span> only flags the applicant for review.
		</span>
	</div>
	<span class="mt-1 shrink-0 font-mono text-[11px] text-muted-foreground">
		{entries.length}
		{entries.length === 1 ? 'entry' : 'entries'}
	</span>
</div>

<div class="overflow-hidden rounded-md border border-border bg-white">
	<!-- Add row -->
	<div class="border-b border-border px-4 py-3">
		<div class="grid grid-cols-[1fr_1fr_1.2fr_1.4fr_auto] gap-2">
			<input
				type="text"
				placeholder="first name *"
				bind:value={addFirstName}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-muted px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<input
				type="text"
				placeholder="last name *"
				bind:value={addLastName}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-muted px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<input
				type="email"
				placeholder="email (preferred)"
				bind:value={addEmail}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-muted px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<input
				type="text"
				placeholder="reason (optional)"
				bind:value={addReason}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-muted px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<button
				onclick={addEntry}
				disabled={!canAdd}
				class="cursor-pointer rounded border border-border bg-white px-3 py-[6px] font-mono text-[11px] font-medium whitespace-nowrap text-primary transition-colors hover:bg-[#fafafa] disabled:cursor-default disabled:opacity-40"
			>
				{adding ? '…' : '+ Add'}
			</button>
		</div>
	</div>

	<!-- Toolbar -->
	<div class="flex items-center gap-2 border-b border-border px-4 py-2">
		<input
			type="text"
			placeholder="search by name or email…"
			bind:value={search}
			class="flex-1 rounded border border-border bg-muted px-2 py-[5px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
		/>
		<input
			bind:this={fileInput}
			type="file"
			accept=".csv,text/csv"
			onchange={onFileSelected}
			class="hidden"
		/>
		<button
			onclick={() => fileInput?.click()}
			disabled={importing}
			title="CSV columns: firstName, lastName, email, reason"
			class="cursor-pointer rounded border border-border bg-white px-3 py-[5px] font-mono text-[11px] whitespace-nowrap text-primary transition-colors hover:bg-[#fafafa] disabled:cursor-default disabled:opacity-40"
		>
			{importing ? '…' : '↑ Import CSV'}
		</button>
	</div>

	<!-- Rows the last import refused, listed so they can be corrected rather than guessed at -->
	{#if importErrors.length}
		<div class="border-b border-[#fde68a] bg-[#fffbeb] px-4 py-2.5">
			<div class="flex items-start justify-between gap-3">
				<div class="text-[12px] text-[#92400e]">
					<span class="font-semibold">
						{importErrors.length}
						{importErrors.length === 1 ? 'row' : 'rows'} skipped:
					</span>
					<ul class="mt-1 space-y-0.5 font-mono text-[11px]">
						{#each importErrors.slice(0, 8) as issue (issue.row)}
							<li>row {issue.row} — {issue.reason}</li>
						{/each}
						{#if importErrors.length > 8}
							<li class="opacity-70">…and {importErrors.length - 8} more</li>
						{/if}
					</ul>
				</div>
				<button
					onclick={() => (importErrors = [])}
					aria-label="Dismiss import errors"
					class="cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-[#92400e] opacity-60 transition-opacity hover:opacity-100"
				>
					✕
				</button>
			</div>
		</div>
	{/if}

	<!-- Table -->
	<div class="max-h-[calc(100vh-340px)] overflow-x-auto overflow-y-auto">
		{#if filtered.length === 0}
			<div class="py-12 text-center font-mono text-[11px] text-muted-foreground">
				{search.trim() ? 'No matching entries' : 'No entries yet'}
			</div>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class="sticky top-0 z-[1] border-b border-border bg-muted">
						{#each ['Name', 'Email', 'Reason', 'Added', ''] as col (col)}
							<th
								class="bg-muted px-[14px] py-[9px] text-left font-mono text-[9px] font-medium tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase"
							>
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each filtered as entry (entry.id)}
						<tr class="border-b border-[#f0f0f0] transition-colors hover:bg-[#fafafa]">
							<td class="px-[14px] py-[10px] text-[13px] text-primary">
								{entry.firstName}
								{entry.lastName}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[12px] text-primary">
								{#if entry.email}
									{entry.email}
								{:else}
									<span
										title="No email on this entry, so it flags for review but never auto-rejects."
										class="text-muted-foreground"
									>
										— name only
									</span>
								{/if}
							</td>
							<td class="px-[14px] py-[10px] text-[12px] text-muted-foreground">
								{entry.reason ?? '—'}
							</td>
							<td
								class="px-[14px] py-[10px] font-mono text-[11px] whitespace-nowrap text-muted-foreground"
							>
								{formatDate(entry.createdAt)}
							</td>
							<td class="px-[14px] py-[10px] text-right">
								<button
									onclick={() => (pendingDelete = entry)}
									aria-label="Remove {entry.firstName} {entry.lastName}"
									class="cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-[#bbb] transition-colors hover:text-destructive"
								>
									✕
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

{#if pendingDelete}
	<DeleteEntryDialog
		entry={pendingDelete}
		isDeleting={deleting}
		onConfirm={confirmRemove}
		onCancel={() => (pendingDelete = null)}
	/>
{/if}

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
