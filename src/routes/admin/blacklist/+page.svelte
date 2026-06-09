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
		const rows = ['name,email,reason', ...entries.map((e) => `${e.name},${e.email},${e.reason ?? ''}`)];
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
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<!-- Header -->
<div class="flex items-center justify-between mb-6">
	<h1 class="text-[22px] font-bold text-primary">Blacklist</h1>
</div>

<!-- Main card -->
<div class="bg-white border border-border rounded-md overflow-hidden">

	<!-- Count bar -->
	<div class="px-4 py-2 border-b border-border">
		<span class="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
			BLACKLIST — {entries.length} ENTRIES
		</span>
	</div>

	<!-- Add row -->
	<div class="px-4 py-3 border-b border-border">
		<div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
			<input
				type="text"
				placeholder="name *"
				bind:value={addName}
				onkeydown={onAddKeydown}
				class="font-mono text-[11px] text-primary bg-[#f9f9f9] border border-border rounded px-2 py-[6px] outline-none focus:border-primary placeholder:text-[#bbb]"
			/>
			<input
				type="email"
				placeholder="email address *"
				bind:value={addEmail}
				onkeydown={onAddKeydown}
				class="font-mono text-[11px] text-primary bg-[#f9f9f9] border border-border rounded px-2 py-[6px] outline-none focus:border-primary placeholder:text-[#bbb]"
			/>
			<input
				type="text"
				placeholder="reason (optional)"
				bind:value={addReason}
				onkeydown={onAddKeydown}
				class="font-mono text-[11px] text-primary bg-[#f9f9f9] border border-border rounded px-2 py-[6px] outline-none focus:border-primary placeholder:text-[#bbb]"
			/>
			<button
				onclick={addEntry}
				disabled={adding || !addName.trim() || !addEmail.trim()}
				class="font-mono text-[11px] font-medium text-primary bg-white border border-border rounded px-3 py-[6px] cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-default hover:bg-[#fafafa] transition-colors"
			>
				{adding ? '…' : '+ADD'}
			</button>
		</div>
	</div>

	<!-- Toolbar -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border">
		<input
			type="text"
			placeholder="search by name or email…"
			bind:value={search}
			class="font-mono text-[11px] text-primary bg-[#f9f9f9] border border-border rounded px-2 py-[5px] flex-1 outline-none focus:border-primary placeholder:text-[#bbb]"
		/>
		<button
			onclick={exportCsv}
			class="font-mono text-[11px] text-primary bg-white border border-border rounded px-3 py-[5px] cursor-pointer hover:bg-[#fafafa] transition-colors whitespace-nowrap"
		>
			↓ CSV
		</button>
		<button
			onclick={importCsv}
			disabled={importing}
			class="font-mono text-[11px] text-primary bg-white border border-border rounded px-3 py-[5px] cursor-pointer hover:bg-[#fafafa] transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-default"
		>
			{importing ? '…' : '↑ Import'}
		</button>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto overflow-y-auto max-h-[calc(100vh-340px)]">
		{#if filtered.length === 0}
			<div class="py-12 text-center font-mono text-[11px] text-muted-foreground">
				{search.trim() ? 'No matching entries' : 'No entries yet'}
			</div>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class="border-b border-border sticky top-0 z-[1] bg-[#f9f9f9]">
						{#each ['NAME', 'EMAIL', 'REASON', 'ADDED', ''] as col}
							<th class="px-[14px] py-[9px] text-left font-mono text-[9px] font-medium tracking-[0.1em] uppercase text-muted-foreground bg-[#f9f9f9] whitespace-nowrap">
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each filtered as entry (entry.id)}
						<tr class="border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors even:bg-[#fafafa]">
							<td class="px-[14px] py-[10px] font-mono text-[12px] text-primary">
								{entry.name}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[12px] text-primary">
								{entry.email}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[11px] text-muted-foreground">
								{entry.reason ?? '—'}
							</td>
							<td class="px-[14px] py-[10px] font-mono text-[11px] text-muted-foreground whitespace-nowrap">
								{formatDate(entry.createdAt)}
							</td>
							<td class="px-[14px] py-[10px] text-right">
								<button
									onclick={() => removeEntry(entry.id)}
									class="font-mono text-[11px] text-[#bbb] hover:text-destructive cursor-pointer bg-transparent border-none p-0 transition-colors"
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
		class="fixed bottom-7 right-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
