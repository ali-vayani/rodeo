<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
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
<div class="mb-6 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Users</h1>
	<button
		onclick={exportCsv}
		disabled={exporting}
		class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium text-primary"
		class:opacity-60={exporting}
	>
		{exporting ? 'Exporting…' : 'Export CSV'}
	</button>
</div>

<!-- Layout: filter sidebar + table area -->
<div class="flex overflow-hidden rounded-md border border-border bg-white">
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
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Search + count bar -->
		<div class="flex items-center gap-3 border-b border-border px-4 py-3">
			<input
				type="text"
				placeholder="Search by name or email…"
				bind:value={search}
				oninput={onSearchInput}
				class="flex-1 rounded border border-border bg-[#f9f9f9] px-3 py-[7px] text-[13px] text-primary outline-none"
			/>
			<span class="text-xs whitespace-nowrap text-muted-foreground">
				{total} total
			</span>
		</div>

		<!-- Scrollable table wrapper -->
		<div
			class="max-h-[calc(100vh-280px)] overflow-x-auto overflow-y-auto transition-opacity"
			class:opacity-50={loadingPage}
		>
			{#if users.length === 0}
				<div class="py-12 text-center text-[13px] text-muted-foreground">No results</div>
			{:else}
				<table class="w-full border-collapse">
					<thead>
						<tr class="sticky top-0 z-[1] border-b border-border bg-[#f9f9f9]">
							{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col}
								<th
									class="bg-[#f9f9f9] px-[14px] py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase"
								>
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.uid)}
							<tr class="border-b border-[#f0f0f0] transition-colors hover:bg-[#fafafa]">
								<td
									class="px-[14px] py-[11px] text-[13px] font-medium whitespace-nowrap text-primary"
								>
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
									<span class="text-[11px] font-semibold tracking-[0.05em] text-[#555] uppercase">
										{user.status.charAt(0) + user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
									</span>
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.pendingDecision}
										<span
											class="inline-block rounded px-[7px] py-0.5 text-[11px] font-semibold {DECISION_CLASS[
												user.pendingDecision
											] ?? 'bg-[#e5e7eb] text-[#374151]'}"
										>
											{decLabel(user.pendingDecision)}
										</span>
									{:else}
										<span class="text-xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.activeDecision}
										<span
											class="inline-block rounded px-[7px] py-0.5 text-[11px] font-semibold {DECISION_CLASS[
												user.activeDecision
											] ?? 'bg-[#e5e7eb] text-[#374151]'}"
										>
											{decLabel(user.activeDecision)}
										</span>
									{:else}
										<span class="text-xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td
									class="px-[14px] py-[11px] font-mono text-xs whitespace-nowrap text-muted-foreground"
								>
									{formatDate(user.createdAt)}
								</td>
								<td class="px-[14px] py-[11px]">
									<button
										onclick={() => openModal(user)}
										class="cursor-pointer rounded border border-border bg-transparent px-[10px] py-1 text-xs text-primary"
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
		class="mt-4 flex items-center justify-center gap-4 transition-opacity"
		class:opacity-50={loadingPage}
		class:pointer-events-none={loadingPage}
	>
		<button
			onclick={() => loadPage(page - 1)}
			disabled={page <= 1 || loadingPage}
			class="rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium {page <=
			1
				? 'cursor-default text-[#cccccc]'
				: 'cursor-pointer text-primary'}"
		>
			← Previous
		</button>

		<span class="font-mono text-[13px] whitespace-nowrap text-muted-foreground">
			{loadingPage ? 'Loading…' : `Page ${page} of ${totalPages}`}
		</span>

		<button
			onclick={() => loadPage(page + 1)}
			disabled={page >= totalPages || loadingPage}
			class="rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium {page >=
			totalPages
				? 'cursor-default text-[#cccccc]'
				: 'cursor-pointer text-primary'}"
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
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Edit user"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeModal()}
			class="flex max-h-[calc(100vh-80px)] w-[560px] max-w-[calc(100vw-48px)] flex-col overflow-y-auto rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
		>
			<!-- Header -->
			<div class="flex shrink-0 items-start justify-between border-b border-border px-6 pt-5 pb-4">
				<div>
					<div class="text-[17px] font-bold text-primary">{selectedUser.name}</div>
					<div class="mt-0.5 text-xs text-muted-foreground">{selectedUser.email}</div>
				</div>
				<button
					onclick={closeModal}
					class="-mt-0.5 cursor-pointer border-none bg-transparent p-0 text-xl leading-none text-muted-foreground"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Info row -->
			<div class="border-b border-[#f0f0f0] px-6 py-4">
				<div class="grid grid-cols-2 gap-[10px]">
					<div>
						<div
							class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							Created
						</div>
						<div class="font-mono text-[13px] text-[#333]">
							{formatDate(selectedUser.createdAt)}
						</div>
					</div>
					<div>
						<div
							class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							UID
						</div>
						<div class="font-mono text-[11px] break-all text-muted-foreground">
							{selectedUser.uid}
						</div>
					</div>
				</div>
			</div>

			<!-- Edit fields -->
			<div class="flex flex-col gap-5 px-6 py-5">
				<!-- Roles -->
				<div>
					<div
						class="mb-[10px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>
						Roles
					</div>
					<div class="flex flex-wrap gap-[10px_16px]">
						{#each ALL_ROLES as role}
							<label class="flex cursor-pointer items-center gap-1.5 text-[13px] text-[#333]">
								<input
									type="checkbox"
									checked={editRoles.includes(role)}
									onchange={() => toggleEditRole(role)}
									class="cursor-pointer accent-primary"
								/>
								{role.charAt(0) + role.slice(1).toLowerCase()}
							</label>
						{/each}
					</div>
				</div>

				<!-- Status + Decisions row -->
				<div class="grid grid-cols-3 gap-3">
					<div>
						<div
							class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							Status
						</div>
						<select
							bind:value={editStatus}
							class="w-full cursor-pointer rounded border border-border bg-white px-2 py-1.5 text-[13px] text-primary outline-none"
						>
							{#each ALL_STATUSES as s}
								<option value={s}
									>{s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}</option
								>
							{/each}
						</select>
					</div>
					<div>
						<div
							class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							Pending Decision
						</div>
						<select
							bind:value={editPending}
							class="w-full cursor-pointer rounded border border-border bg-white px-2 py-1.5 text-[13px] text-primary outline-none"
						>
							<option value="">None</option>
							{#each DECISION_VALUES as d}
								<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
							{/each}
						</select>
					</div>
					<div>
						<div
							class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							Active Decision
						</div>
						<select
							bind:value={editActive}
							class="w-full cursor-pointer rounded border border-border bg-white px-2 py-1.5 text-[13px] text-primary outline-none"
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
			<div class="flex shrink-0 justify-end border-t border-border px-6 py-4">
				<button
					onclick={saveAll}
					disabled={saving}
					class="cursor-pointer rounded-md border-none bg-primary px-5 py-[9px] text-[13px] font-semibold text-white"
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
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
