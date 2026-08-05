<script lang="ts">
	import { createClient } from '$lib/trpc/client';
	import type { RecipientParams } from '$lib/admin/filters';

	const PAGE_SIZE = 100;

	let {
		open,
		filters,
		total,
		onClose
	}: {
		open: boolean;
		filters: RecipientParams;
		total: number;
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

	let filtered = $derived(
		search.trim()
			? rows.filter((r) =>
					`${r.name} ${r.email}`.toLowerCase().includes(search.trim().toLowerCase())
				)
			: rows
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
			? 'border-[#16a34a] bg-[#f0fdf4] text-[#16a34a]'
			: copyState === 'failed'
				? 'border-destructive bg-[#fff1f2] text-destructive'
				: 'border-border bg-white text-primary hover:bg-muted active:bg-[#ebebeb]'
	);
</script>

{#if open}
	<div
		role="presentation"
		onclick={onClose}
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="All recipients"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			class="flex max-h-[80vh] w-[560px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
		>
			<div class="flex items-center justify-between border-b border-border px-6 pt-5 pb-4">
				<div>
					<div class="text-[15px] font-semibold text-primary">Recipients</div>
					<div class="mt-0.5 text-xs text-muted-foreground">
						{total} user{total === 1 ? '' : 's'} match the current selection
					</div>
				</div>
				<button
					onclick={onClose}
					aria-label="Close"
					class="cursor-pointer border-none bg-transparent text-[18px] leading-none text-muted-foreground hover:text-primary"
				>
					×
				</button>
			</div>

			<div class="flex items-center gap-2 border-b border-border px-6 py-3">
				<input
					bind:value={search}
					placeholder="Filter this list…"
					aria-label="Filter recipients"
					class="flex-1 rounded border border-border bg-white px-3 py-[6px] text-[13px] text-primary outline-none focus:border-primary"
				/>
				<button
					onclick={copyAll}
					disabled={filtered.length === 0}
					aria-live="polite"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-[14px] py-[6px] text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 {copyClass}"
				>
					{#if copyState === 'copied'}
						<span class="text-[11px] leading-none font-extrabold">✓</span>
					{:else if copyState === 'failed'}
						<span class="text-[11px] leading-none font-extrabold">✕</span>
					{/if}
					{copyLabel}
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-3">
				{#if loading}
					<div class="py-6 text-center text-xs text-muted-foreground">Loading…</div>
				{:else if error}
					<div class="py-6 text-center text-xs text-destructive">{error}</div>
				{:else if filtered.length === 0}
					<div class="py-6 text-center text-xs text-muted-foreground">No matches.</div>
				{:else}
					<ul class="space-y-1">
						{#each filtered as r (r.uid)}
							<li class="flex items-baseline justify-between gap-4 py-[3px] text-[13px]">
								<span class="truncate text-primary">{r.name}</span>
								<span class="shrink-0 font-mono text-[12px] text-muted-foreground">{r.email}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if total > PAGE_SIZE}
				<div class="border-t border-border px-6 py-3 text-xs text-muted-foreground">
					Showing the first {PAGE_SIZE} of {total}.
				</div>
			{/if}
		</div>
	</div>
{/if}
