<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import Toast from '$lib/components/ui/Toast.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Entry = (typeof data.entries)[number];

	let entries = $state<Entry[]>(untrack(() => [...data.entries]));

	// --- Add form ---
	let addName = $state('');
	let addEmail = $state('');
	let addReason = $state('');
	let adding = $state(false);

	async function addEntry() {
		if (!addName.trim() || !addEmail.trim()) return;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail.trim())) {
			showToast('Please enter a valid email address', 'error');
			return;
		}
		adding = true;
		try {
			const entry = await trpc.blacklist.add.mutate({
				name: addName.trim(),
				email: addEmail.trim(),
				reason: addReason.trim() || undefined
			});
			entries = [entry, ...entries];
			addName = '';
			addEmail = '';
			addReason = '';
			showToast('Entry added');
		} catch (e: any) {
			showToast(e.message ?? 'Failed to add entry', 'error');
		} finally {
			adding = false;
		}
	}

	function onAddKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') addEntry();
	}

	// --- Remove ---
	async function removeEntry(id: string) {
		try {
			await trpc.blacklist.remove.mutate({ id });
			entries = entries.filter((e) => e.id !== id);
			showToast('Entry removed');
		} catch (e: any) {
			showToast(e.message ?? 'Failed to remove', 'error');
		}
	}

	// --- Search ---
	let search = $state('');

	let filtered = $derived(
		search.trim()
			? entries.filter(
					(e) =>
						e.name.toLowerCase().includes(search.trim().toLowerCase()) ||
						e.email.toLowerCase().includes(search.trim().toLowerCase())
				)
			: entries
	);

	// --- CSV Export ---
	function exportCsv() {
		const rows = [
			'name,email,reason',
			...entries.map((e) => `${e.name},${e.email},${e.reason ?? ''}`)
		];
		const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'blacklist.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	// --- CSV Import ---
	let importing = $state(false);

	function importCsv() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const text = await file.text();
			const lines = text.trim().split('\n').slice(1);
			const parsed = lines.flatMap((line) => {
				const [name, email, reason] = line.split(',').map((s) => s.trim());
				if (name && email) return [{ name, email, reason: reason || undefined }];
				return [];
			});
			if (!parsed.length) {
				showToast('No valid entries found in CSV', 'error');
				return;
			}
			importing = true;
			try {
				await trpc.blacklist.addBulk.mutate(parsed);
				entries = await trpc.blacklist.list.query();
				showToast(`Imported ${parsed.length} entries`);
			} catch (e: any) {
				showToast(e.message ?? 'Import failed', 'error');
			} finally {
				importing = false;
			}
		};
		input.click();
	}

	// --- Toast ---
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	// --- Helpers ---
	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<!-- Header -->
<div class="mb-6 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Blacklist</h1>
</div>

<!-- Main card -->
<div class="overflow-hidden rounded-md border border-border bg-white">
	<!-- Count bar -->
	<div class="border-b border-border px-4 py-2">
		<span class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
			BLACKLIST — {entries.length} ENTRIES
		</span>
	</div>

	<!-- Add row -->
	<div class="border-b border-border px-4 py-3">
		<div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
			<input
				type="text"
				placeholder="name *"
				bind:value={addName}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-[#f9f9f9] px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<input
				type="email"
				placeholder="email address *"
				bind:value={addEmail}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-[#f9f9f9] px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<input
				type="text"
				placeholder="reason (optional)"
				bind:value={addReason}
				onkeydown={onAddKeydown}
				class="rounded border border-border bg-[#f9f9f9] px-2 py-[6px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
			/>
			<button
				onclick={addEntry}
				disabled={adding || !addName.trim() || !addEmail.trim()}
				class="cursor-pointer rounded border border-border bg-white px-3 py-[6px] font-mono text-[11px] font-medium whitespace-nowrap text-primary transition-colors hover:bg-[#fafafa] disabled:cursor-default disabled:opacity-40"
			>
				{adding ? '…' : '+ADD'}
			</button>
		</div>
	</div>

	<!-- Toolbar -->
	<div class="flex items-center gap-2 border-b border-border px-4 py-2">
		<input
			type="text"
			placeholder="search by name or email…"
			bind:value={search}
			class="flex-1 rounded border border-border bg-[#f9f9f9] px-2 py-[5px] font-mono text-[11px] text-primary outline-none placeholder:text-[#bbb] focus:border-primary"
		/>
		<button
			onclick={exportCsv}
			class="cursor-pointer rounded border border-border bg-white px-3 py-[5px] font-mono text-[11px] whitespace-nowrap text-primary transition-colors hover:bg-[#fafafa]"
		>
			↓ CSV
		</button>
		<button
			onclick={importCsv}
			disabled={importing}
			class="cursor-pointer rounded border border-border bg-white px-3 py-[5px] font-mono text-[11px] whitespace-nowrap text-primary transition-colors hover:bg-[#fafafa] disabled:cursor-default disabled:opacity-40"
		>
			{importing ? '…' : '↑ Import'}
		</button>
	</div>

	<!-- Table -->
	<div class="max-h-[calc(100vh-340px)] overflow-x-auto overflow-y-auto">
		{#if filtered.length === 0}
			<div class="py-12 text-center font-mono text-[11px] text-muted-foreground">
				{search.trim() ? 'No matching entries' : 'No entries yet'}
			</div>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class="sticky top-0 z-[1] border-b border-border bg-[#f9f9f9]">
						{#each ['NAME', 'EMAIL', 'REASON', 'ADDED', ''] as col}
							<th
								class="bg-[#f9f9f9] px-[14px] py-[9px] text-left font-mono text-[9px] font-medium tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase"
							>
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each filtered as entry (entry.id)}
						<tr
							class="border-b border-[#f0f0f0] transition-colors even:bg-[#fafafa] hover:bg-[#fafafa]"
						>
							<td class="px-[14px] py-[10px] font-mono text-[12px] text-primary">
								{entry.name}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[12px] text-primary">
								{entry.email}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[11px] text-muted-foreground">
								{entry.reason ?? '—'}
							</td>
							<td
								class="px-[14px] py-[10px] font-mono text-[11px] whitespace-nowrap text-muted-foreground"
							>
								{formatDate(entry.createdAt)}
							</td>
							<td class="px-[14px] py-[10px] text-right">
								<button
									onclick={() => removeEntry(entry.id)}
									class="cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-[#bbb] transition-colors hover:text-destructive"
									aria-label="Remove entry"
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

<!-- Toast -->
{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
