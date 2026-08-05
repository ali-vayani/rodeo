<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_VALUES,
		DECISION_OPTIONS,
		allChecked,
		buildRecipientParams
	} from '$lib/admin/filters';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type User = (typeof data.users)[number];

	// Snapshot from server; updated client-side on pagination / edits
	let users = $state<User[]>(untrack(() => [...data.users]));
	let total = $state(untrack(() => data.total));
	let page = $state(1);
	const PAGE_SIZE = untrack(() => data.pageSize);
	let totalPages = $derived(Math.ceil(total / PAGE_SIZE));
	let loadingPage = $state(false);

	async function loadPage(p: number) {
		loadingPage = true;
		try {
			const result = await trpc.user.list.query(buildListParams(p));
			users = result.users;
			total = result.total;
			page = p;
		} catch (e: any) {
			showToast(e.message ?? 'Failed to load page', 'error');
		} finally {
			loadingPage = false;
		}
	}

	// --- Filter state ---
	// Vocabulary and the checkbox-state → tRPC-params translation are shared with the
	// custom-email wizard, so a count here and a send there can't disagree.
	let roleFilter = $state(allChecked(ALL_ROLES));
	let statusFilter = $state(allChecked(ALL_STATUSES));
	let decisionFilter = $state(allChecked(DECISION_OPTIONS));
	let search = $state('');

	function buildListParams(p: number) {
		return {
			page: p,
			pageSize: PAGE_SIZE,
			...buildRecipientParams(roleFilter, statusFilter, decisionFilter, search)
		} as any;
	}

	// Checkbox toggles immediately re-fetch page 1 with new filters
	function toggleRole(r: string) {
		roleFilter = { ...roleFilter, [r]: !roleFilter[r] };
		loadPage(1);
	}
	function toggleStatus(s: string) {
		statusFilter = { ...statusFilter, [s]: !statusFilter[s] };
		loadPage(1);
	}
	function toggleDecision(d: string) {
		decisionFilter = { ...decisionFilter, [d]: !decisionFilter[d] };
		loadPage(1);
	}

	function clearRole() {
		roleFilter = Object.fromEntries(ALL_ROLES.map((r) => [r, false]));
		loadPage(1);
	}
	function clearStatus() {
		statusFilter = Object.fromEntries(ALL_STATUSES.map((s) => [s, false]));
		loadPage(1);
	}
	function clearDecision() {
		decisionFilter = Object.fromEntries(DECISION_OPTIONS.map((d) => [d, false]));
		loadPage(1);
	}

	// Search is debounced
	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => loadPage(1), 400);
	}

	// --- CSV export ---
	let exporting = $state(false);

	async function exportCsv() {
		exporting = true;
		try {
			const csv = await trpc.user.exportCsv.query();
			const blob = new Blob([csv], { type: 'text/csv' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'users.csv';
			a.click();
			URL.revokeObjectURL(url);
		} finally {
			exporting = false;
		}
	}

	// --- Toast ---
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	// --- Modal state ---
	let selectedUser = $state<User | null>(null);
	let editRoles = $state<string[]>([]);
	let editStatus = $state('');
	let editPending = $state<string>('');
	let editActive = $state<string>('');
	let saving = $state(false);

	function openModal(user: User) {
		selectedUser = user;
		editRoles = [...user.roles];
		editStatus = user.status;
		editPending = user.pendingDecision ?? '';
		editActive = user.activeDecision ?? '';
	}

	function closeModal() {
		selectedUser = null;
	}

	function toggleEditRole(role: string) {
		if (editRoles.includes(role)) {
			editRoles = editRoles.filter((r) => r !== role);
		} else {
			editRoles = [...editRoles, role];
		}
	}

	async function saveAll() {
		if (!selectedUser) return;
		saving = true;
		try {
			const [roleResult, statusResult, decisionResult] = await Promise.all([
				trpc.user.updateRole.mutate({ uid: selectedUser.uid, roles: editRoles as any }),
				trpc.user.updateStatus.mutate({ uid: selectedUser.uid, status: editStatus as any }),
				trpc.user.updateDecisions.mutate({
					uid: selectedUser.uid,
					pendingDecision: (editPending || null) as any,
					activeDecision: (editActive || null) as any
				})
			]);
			const merged = { ...roleResult, ...statusResult, ...decisionResult } as User;
			users = users.map((u) => (u.uid === merged.uid ? { ...u, ...merged } : u));
			closeModal();
			showToast('User saved');
		} catch (e: any) {
			showToast(e.message ?? 'Failed to save', 'error');
		} finally {
			saving = false;
		}
	}

	// --- Display helpers ---
	const DECISION_CLASS: Record<string, string> = {
		ACCEPTED: 'bg-[#d1fae5] text-[#065f46]',
		WAITLISTED: 'bg-[#fef9c3] text-[#713f12]',
		REJECTED: 'bg-[#fee2e2] text-[#991b1b]',
		PENDING: 'bg-[#e5e7eb] text-[#374151]'
	};

	function decLabel(d: string | null): string {
		if (!d) return '—';
		return d.charAt(0) + d.slice(1).toLowerCase();
	}

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<!-- Header -->
<div class="flex items-center justify-between mb-6">
	<h1 class="text-[22px] font-bold text-primary">Users</h1>
	<button
		onclick={exportCsv}
		disabled={exporting}
		class="text-[13px] font-medium text-primary bg-white border border-border rounded-md py-[7px] px-[14px] cursor-pointer"
		class:opacity-60={exporting}
	>
		{exporting ? 'Exporting…' : 'Export CSV'}
	</button>
</div>

<!-- Layout: filter sidebar + table area -->
<div class="flex bg-white border border-border rounded-md overflow-hidden">
	<UserFilters
		{roleFilter}
		onToggleRole={toggleRole}
		onClearRole={clearRole}
		{statusFilter}
		onToggleStatus={toggleStatus}
		onClearStatus={clearStatus}
		{decisionFilter}
		onToggleDecision={toggleDecision}
		onClearDecision={clearDecision}
	/>

	<!-- Table area -->
	<div class="flex-1 min-w-0 flex flex-col">
		<!-- Search + count bar -->
		<div class="flex items-center gap-3 px-4 py-3 border-b border-border">
			<input
				type="text"
				placeholder="Search by name or email…"
				bind:value={search}
				oninput={onSearchInput}
				class="flex-1 text-[13px] text-primary bg-[#f9f9f9] border border-border rounded py-[7px] px-3 outline-none"
			/>
			<span class="text-xs text-muted-foreground whitespace-nowrap">
				{total} total
			</span>
		</div>

		<!-- Scrollable table wrapper -->
		<div
			class="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] transition-opacity"
			class:opacity-50={loadingPage}
		>
			{#if users.length === 0}
				<div class="py-12 text-center text-[13px] text-muted-foreground">
					No results
				</div>
			{:else}
				<table class="w-full border-collapse">
					<thead>
						<tr class="border-b border-border sticky top-0 z-[1] bg-[#f9f9f9]">
							{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col}
								<th class="px-[14px] py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground whitespace-nowrap bg-[#f9f9f9]">
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.uid)}
							<tr class="border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors">
								<td class="px-[14px] py-[11px] text-[13px] font-medium text-primary whitespace-nowrap">
									{user.name}
								</td>
								<td class="px-[14px] py-[11px] text-xs text-muted-foreground">
									{user.email}
								</td>
								<td class="px-[14px] py-[11px] text-[13px] text-[#333]">
									{#if user.roles.length}
										{user.roles[0].charAt(0) + user.roles[0].slice(1).toLowerCase()}
									{:else}
										—
									{/if}
								</td>
								<td class="px-[14px] py-[11px]">
									<span class="text-[11px] font-semibold tracking-[0.05em] uppercase text-[#555]">
										{user.status.charAt(0) +
											user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
									</span>
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.pendingDecision}
										<span class="inline-block px-[7px] py-0.5 rounded text-[11px] font-semibold {DECISION_CLASS[user.pendingDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
											{decLabel(user.pendingDecision)}
										</span>
									{:else}
										<span class="text-xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.activeDecision}
										<span class="inline-block px-[7px] py-0.5 rounded text-[11px] font-semibold {DECISION_CLASS[user.activeDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
											{decLabel(user.activeDecision)}
										</span>
									{:else}
										<span class="text-xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td class="px-[14px] py-[11px] text-xs text-muted-foreground font-mono whitespace-nowrap">
									{formatDate(user.createdAt)}
								</td>
								<td class="px-[14px] py-[11px]">
									<button
										onclick={() => openModal(user)}
										class="text-xs text-primary bg-transparent border border-border rounded px-[10px] py-1 cursor-pointer"
									>
										Edit
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</div>
</div>

<!-- Pagination bar -->
{#if totalPages > 1}
	<div
		class="flex items-center justify-center gap-4 mt-4 transition-opacity"
		class:opacity-50={loadingPage}
		class:pointer-events-none={loadingPage}
	>
		<button
			onclick={() => loadPage(page - 1)}
			disabled={page <= 1 || loadingPage}
			class="text-[13px] font-medium bg-white border border-border rounded-md py-[7px] px-[14px] {page <= 1 ? 'text-[#cccccc] cursor-default' : 'text-primary cursor-pointer'}"
		>
			← Previous
		</button>

		<span class="text-[13px] text-muted-foreground font-mono whitespace-nowrap">
			{loadingPage ? 'Loading…' : `Page ${page} of ${totalPages}`}
		</span>

		<button
			onclick={() => loadPage(page + 1)}
			disabled={page >= totalPages || loadingPage}
			class="text-[13px] font-medium bg-white border border-border rounded-md py-[7px] px-[14px] {page >= totalPages ? 'text-[#cccccc] cursor-default' : 'text-primary cursor-pointer'}"
		>
			Next →
		</button>
	</div>
{/if}

<!-- User detail modal -->
{#if selectedUser}
	<div
		role="presentation"
		onclick={closeModal}
		class="fixed inset-0 bg-black/45 z-[100] flex items-center justify-center"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Edit user"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeModal()}
			class="bg-white rounded-lg w-[560px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-80px)] overflow-y-auto shadow-[0_8px_32px_rgba(0,0,0,0.18)] flex flex-col"
		>
			<!-- Header -->
			<div class="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
				<div>
					<div class="text-[17px] font-bold text-primary">{selectedUser.name}</div>
					<div class="text-xs text-muted-foreground mt-0.5">{selectedUser.email}</div>
				</div>
				<button
					onclick={closeModal}
					class="text-xl leading-none bg-transparent border-none text-muted-foreground cursor-pointer p-0 -mt-0.5"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Info row -->
			<div class="px-6 py-4 border-b border-[#f0f0f0]">
				<div class="grid grid-cols-2 gap-[10px]">
					<div>
						<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
							Created
						</div>
						<div class="text-[13px] text-[#333] font-mono">
							{formatDate(selectedUser.createdAt)}
						</div>
					</div>
					<div>
						<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
							UID
						</div>
						<div class="text-[11px] text-muted-foreground font-mono break-all">
							{selectedUser.uid}
						</div>
					</div>
				</div>
			</div>

			<!-- Edit fields -->
			<div class="px-6 py-5 flex flex-col gap-5">
				<!-- Roles -->
				<div>
					<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[10px]">
						Roles
					</div>
					<div class="flex flex-wrap gap-[10px_16px]">
						{#each ALL_ROLES as role}
							<label class="flex items-center gap-1.5 text-[13px] text-[#333] cursor-pointer">
								<input
									type="checkbox"
									checked={editRoles.includes(role)}
									onchange={() => toggleEditRole(role)}
									class="accent-primary cursor-pointer"
								/>
								{role.charAt(0) + role.slice(1).toLowerCase()}
							</label>
						{/each}
					</div>
				</div>

				<!-- Status + Decisions row -->
				<div class="grid grid-cols-3 gap-3">
					<div>
						<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
							Status
						</div>
						<select
							bind:value={editStatus}
							class="w-full text-[13px] text-primary bg-white border border-border rounded px-2 py-1.5 cursor-pointer outline-none"
						>
							{#each ALL_STATUSES as s}
								<option value={s}
									>{s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}</option
								>
							{/each}
						</select>
					</div>
					<div>
						<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
							Pending Decision
						</div>
						<select
							bind:value={editPending}
							class="w-full text-[13px] text-primary bg-white border border-border rounded px-2 py-1.5 cursor-pointer outline-none"
						>
							<option value="">None</option>
							{#each DECISION_VALUES as d}
								<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
							{/each}
						</select>
					</div>
					<div>
						<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
							Active Decision
						</div>
						<select
							bind:value={editActive}
							class="w-full text-[13px] text-primary bg-white border border-border rounded px-2 py-1.5 cursor-pointer outline-none"
						>
							<option value="">None</option>
							{#each DECISION_VALUES as d}
								<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="px-6 py-4 border-t border-border flex justify-end shrink-0">
				<button
					onclick={saveAll}
					disabled={saving}
					class="text-[13px] font-semibold text-white bg-primary border-none rounded-md py-[9px] px-5 cursor-pointer"
					class:opacity-60={saving}
				>
					{saving ? 'Saving…' : 'Save Changes'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Toast (slides in from right) -->
{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed bottom-7 right-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
