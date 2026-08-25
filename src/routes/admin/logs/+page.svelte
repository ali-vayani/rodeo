<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import { Badge, Button, Combobox, Input, Modal } from '$lib/components/ui';
	import { DataTable, PageHeader, Pagination } from '$lib/components/patterns';
	import type { Column, ComboboxOption } from '$lib/components/ui/types';
	import { LOG_ACTION_GROUPS, actionLabel } from '$lib/log/actions';
	import { actionTone } from '$lib/log/notable';
	import { formatDateTime, pluralize, EM_DASH } from '$lib/format';
	import { toast } from '$lib/ui/toast.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Entry = PageData['initial']['entries'][number];

	const PAGE_SIZE = 50;

	let entries = $state<Entry[]>(untrack(() => data.initial.entries));
	let total = $state(untrack(() => data.initial.total));
	let page = $state(1);
	let loading = $state(false);

	let search = $state('');
	let actorId = $state('');
	let action = $state('');
	let from = $state('');
	let to = $state('');

	const hasFilters = $derived(Boolean(search.trim() || actorId || action || from || to));

	// The leading blank row is the "no filter" choice, so these lists do not want
	// `clearable`; that prop is for a control whose options do not include one.
	const actorOptions: ComboboxOption[] = $derived([
		{ value: '', label: 'All admins' },
		...data.actors.map((a) => ({ value: a.actorId, label: `${a.name} (${a.count})` }))
	]);

	// Flattened with a group heading as a disabled row: the Combobox primitive takes a
	// single option list, and a second dropdown for the group is two controls to find one
	// action.
	const actionOptions: ComboboxOption[] = [
		{ value: '', label: 'All actions' },
		...LOG_ACTION_GROUPS.flatMap((group) => [
			{ value: `__${group.group}`, label: group.group.toUpperCase(), disabled: true },
			...group.actions.map((a) => ({ value: a.key, label: `   ${a.label}` }))
		])
	];

	/**
	 * Fetch one page under the current filters. Always resets to page 1 unless told
	 * otherwise, since a filter that narrows 400 entries to 3 while you sit on page 5
	 * would show an empty table.
	 */
	async function fetchPage(nextPage = 1) {
		loading = true;
		try {
			const result = await trpc.log.list.query({
				page: nextPage,
				pageSize: PAGE_SIZE,
				search: search.trim() || undefined,
				actorId: actorId || undefined,
				action: action || undefined,
				from: from ? new Date(from) : undefined,
				// The input yields a bare date, which parses as midnight; without this the
				// "to" bound silently excludes everything that happened that day.
				to: to ? new Date(`${to}T23:59:59.999`) : undefined
			});

			entries = result.entries;
			total = result.total;
			page = nextPage;
		} catch (e) {
			toast.fromError(e, 'Failed to load the activity log');
		} finally {
			loading = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => fetchPage(1), 300);
	}

	function clearFilters() {
		search = '';
		actorId = '';
		action = '';
		from = '';
		to = '';
		fetchPage(1);
	}

	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	/** The row whose full record is open. Kept alongside `detailOpen` so the dialog can
	    animate out without its contents vanishing mid-transition. */
	let selected = $state<Entry | null>(null);
	let detailOpen = $state(false);

	function openDetail(entry: Entry) {
		selected = entry;
		detailOpen = true;
	}

	/** `metadata` is `JsonValue`; only an object has entries worth listing. */
	const selectedMetadata = $derived.by(() => {
		const meta = selected?.metadata;
		if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
		return Object.entries(meta as Record<string, unknown>).map(([key, value]) => ({
			key,
			value: Array.isArray(value)
				? value.join(', ') || EM_DASH
				: value === null || value === undefined
					? EM_DASH
					: String(value)
		}));
	});

	// Column widths only from lg up: below that the viewport cannot afford them, and fixed
	// widths inflate the table's intrinsic width, pushing the page wider instead of
	// scrolling the table.
	const COLUMNS: Column<Entry>[] = [
		{ key: 'timestamp', header: 'When', nowrap: true, width: 'lg:w-40' },
		{ key: 'actor', header: 'Admin', nowrap: true, width: 'lg:w-44' },
		{ key: 'action', header: 'Action', nowrap: true, width: 'lg:w-52' },
		// Truncated to keep every row one line tall; the click-through modal has the
		// full text, which failure-reason summaries can easily run past a screen line.
		{ key: 'summary', header: 'Detail', truncate: true }
	];
</script>

<PageHeader title="Activity Log">
	{#snippet description()}
		Every administrative action, newest first. Entries are append-only and cannot be edited or
		removed.
	{/snippet}
	{#snippet meta()}{pluralize(total, 'entry', 'entries')}{/snippet}
</PageHeader>

<div class="flex flex-col gap-4">
	<div class="grid grid-cols-2 items-end gap-2 lg:grid-cols-[1.6fr_1fr_1fr_auto_auto_auto]">
		<Input
			bind:value={search}
			oninput={onSearchInput}
			placeholder="search admin, applicant, or detail…"
			mono
			aria-label="Search the activity log"
			class="col-span-2 lg:col-span-1"
		/>
		<Combobox
			bind:value={actorId}
			options={actorOptions}
			placeholder="All admins"
			ariaLabel="Filter by admin"
			onChange={() => fetchPage(1)}
			class="col-span-2 lg:col-span-1"
		/>
		<Combobox
			bind:value={action}
			options={actionOptions}
			placeholder="All actions"
			ariaLabel="Filter by action"
			onChange={() => fetchPage(1)}
			class="col-span-2 lg:col-span-1"
		/>
		<Input
			bind:value={from}
			type="date"
			mono
			onchange={() => fetchPage(1)}
			aria-label="From date"
		/>
		<Input bind:value={to} type="date" mono onchange={() => fetchPage(1)} aria-label="To date" />
		<Button onclick={clearFilters} disabled={!hasFilters} class="col-span-2 lg:col-span-1">
			Clear
		</Button>
	</div>

	<DataTable
		columns={COLUMNS}
		rows={entries}
		rowKey={(entry) => entry.id}
		{loading}
		stickyHeader
		scrollClass="workspace-max-h"
		onRowClick={openDetail}
		emptyMessage={hasFilters ? 'No entries match these filters' : 'No activity recorded yet'}
	>
		{#snippet cell({ row, column })}
			{#if column.key === 'timestamp'}
				<span class="font-mono text-sm text-foreground-secondary">
					{formatDateTime(row.timestamp)}
				</span>
			{:else if column.key === 'actor'}
				<span class="font-medium">{row.actorName ?? 'System'}</span>
			{:else if column.key === 'action'}
				<Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge>
			{:else}
				<span class="text-foreground-secondary">{row.summary}</span>
			{/if}
		{/snippet}
	</DataTable>

	<Pagination {page} {totalPages} {loading} onChange={(next) => fetchPage(next)} />
</div>

<Modal
	bind:open={detailOpen}
	onClose={() => (selected = null)}
	title="Log entry"
	size="md"
	bodyClass="flex flex-col gap-4"
>
	{#if selected}
		<div class="flex flex-col gap-1">
			<Badge tone={actionTone(selected.action)}>{actionLabel(selected.action)}</Badge>
			<p class="mt-2 mb-0 text-base text-foreground">
				<span class="font-medium">{selected.actorName ?? 'System'}</span>
				{selected.summary}
			</p>
		</div>

		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">When</dt>
			<dd class="m-0 font-mono text-foreground-secondary">{formatDateTime(selected.timestamp)}</dd>

			<dt class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">Admin</dt>
			<dd class="m-0 text-foreground-secondary">
				{selected.actorName ?? 'System'}
				{#if selected.actorEmail}
					<span class="font-mono text-foreground-tertiary">· {selected.actorEmail}</span>
				{/if}
			</dd>

			{#if selected.targetLabel || selected.targetId}
				<dt class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
					Target
				</dt>
				<dd class="m-0 text-foreground-secondary">
					{selected.targetLabel ?? EM_DASH}
					{#if selected.targetId}
						<span class="font-mono text-foreground-tertiary">· {selected.targetId}</span>
					{/if}
				</dd>
			{/if}

			<dt class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">Action</dt>
			<dd class="m-0 font-mono text-foreground-secondary">{selected.action}</dd>
		</dl>

		{#if selectedMetadata.length}
			<div class="rounded-lg border border-border bg-muted px-3 py-2">
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-sm">
					{#each selectedMetadata as item (item.key)}
						<dt class="text-foreground-tertiary">{item.key}</dt>
						<dd class="m-0 break-all text-foreground-secondary">{item.value}</dd>
					{/each}
				</dl>
			</div>
		{/if}
	{/if}
</Modal>
