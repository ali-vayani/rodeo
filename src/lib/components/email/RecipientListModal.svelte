<script lang="ts">
	import { createClient } from '$lib/trpc/client';
	import type { RecipientParams } from '$lib/admin/filters';
	import { EmptyState, Input, Modal } from '$lib/components/ui';

	const PAGE_SIZE = 100;

	let {
		open,
		filters,
		total,
		/** Recipients with no account. They are in `total` but not in `user.list`. */
		externalEmails = [],
		onClose
	}: {
		open: boolean;
		filters: RecipientParams;
		total: number;
		externalEmails?: string[];
		onClose: () => void;
	} = $props();

	const trpc = createClient();

	type Row = { uid: string; name: string; email: string };

	let rows = $state<Row[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let search = $state('');

	// Reuses user.list, which runs the same buildRecipientWhere as the count and the
	// send — so this list can never disagree with the number it was opened from.
	$effect(() => {
		if (!open) return;
		let cancelled = false;
		loading = true;
		error = null;
		trpc.user.list
			.query({ ...filters, page: 1, pageSize: PAGE_SIZE } as never)
			.then((r) => {
				if (cancelled) return;
				rows = r.users.map((u: Row) => ({ uid: u.uid, name: u.name, email: u.email }));
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				error = e instanceof Error ? e.message : 'Failed to load recipients';
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	// External addresses aren't rows in the User table, so user.list can't return
	// them — they are folded in here rather than left out of a list titled "all N".
	let allRows = $derived<Row[]>([
		...rows,
		...externalEmails.map((email) => ({ uid: `ext:${email}`, name: 'No account', email }))
	]);

	let filtered = $derived(
		search.trim()
			? allRows.filter((r) =>
					`${r.name} ${r.email}`.toLowerCase().includes(search.trim().toLowerCase())
				)
			: allRows
	);

	let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let copyTimer: ReturnType<typeof setTimeout>;

	async function copyAll() {
		clearTimeout(copyTimer);
		try {
			await navigator.clipboard.writeText(filtered.map((r) => r.email).join(', '));
			copyState = 'copied';
		} catch {
			// Clipboard access is denied outside a secure context — say so rather than
			// looking like it worked.
			copyState = 'failed';
		}
		copyTimer = setTimeout(() => (copyState = 'idle'), 1800);
	}

	let copyLabel = $derived(
		copyState === 'copied'
			? `Copied ${filtered.length}`
			: copyState === 'failed'
				? 'Copy failed'
				: 'Copy emails'
	);

	// Mirrors Toast's success/error palette so feedback reads the same everywhere.
	let copyClass = $derived(
		copyState === 'copied'
			? 'border-success-200 bg-success-50 text-success-700'
			: copyState === 'failed'
				? 'border-destructive bg-danger-50 text-destructive'
				: 'border-border bg-card text-foreground hover:bg-muted active:bg-neutral-100'
	);
</script>

<Modal
	{open}
	title="Recipients"
	description="{total} recipient{total === 1 ? '' : 's'} in the current selection"
	size="lg"
	bodyClass="p-0"
	{onClose}
>
	<div class="flex items-center gap-2 border-b border-border px-6 py-3">
		<Input bind:value={search} placeholder="Filter this list…" aria-label="Filter recipients" />
		<button
			onclick={copyAll}
			disabled={filtered.length === 0}
			aria-live="polite"
			class="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3.5 text-base font-medium whitespace-nowrap transition-colors duration-150 focus-visible:shadow-ring disabled:opacity-50 {copyClass}"
		>
			{#if copyState === 'copied'}
				<span class="text-xs leading-none font-extrabold">✓</span>
			{:else if copyState === 'failed'}
				<span class="text-xs leading-none font-extrabold">✕</span>
			{/if}
			{copyLabel}
		</button>
	</div>

	<div class="panel-scroll px-6 py-3">
		{#if loading}
			<EmptyState compact message="Loading…" />
		{:else if error}
			<p class="m-0 py-6 text-center text-xs text-destructive">{error}</p>
		{:else if filtered.length === 0}
			<EmptyState compact message="No matches." />
		{:else}
			<ul class="m-0 list-none space-y-1 p-0">
				{#each filtered as r (r.uid)}
					<li class="flex items-baseline justify-between gap-4 py-0.5 text-base">
						<span class="truncate text-foreground">{r.name}</span>
						<span class="shrink-0 font-mono text-sm text-foreground-secondary">{r.email}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if total > PAGE_SIZE}
			<p class="mt-3 mb-0 border-t border-border-subtle pt-3 text-xs text-foreground-secondary">
				Showing the first {PAGE_SIZE} of {total}.
			</p>
		{/if}
	</div>
</Modal>
