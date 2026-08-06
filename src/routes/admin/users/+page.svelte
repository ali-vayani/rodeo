<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Button, Modal } from '$lib/components/ui';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_VALUES,
		DECISION_OPTIONS,
		allChecked,
		buildRecipientParams
	} from '$lib/admin/filters';
	import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import { STAFF_ROLES } from '$lib/auth/permissions';

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
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load page'), 'error');
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
		};
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
	let detailOpen = $state(false);
	let selectedUser = $state<User | null>(null);
	// Typed as the enums rather than plain strings; '' is the modal's own "unset"
	// for the two nullable decision fields and is mapped back to null on save.
	let editRole = $state<Role>(Role.UNDECLARED);
	let editStatus = $state<UserStatus>(UserStatus.CREATED);
	let editPending = $state<DecisionStatus | ''>('');
	let editActive = $state<DecisionStatus | ''>('');
	let saving = $state(false);

	function openModal(user: User) {
		selectedUser = user;
		editRole = user.role;
		editStatus = user.status;
		editPending = user.pendingDecision ?? '';
		editActive = user.activeDecision ?? '';
		detailOpen = true;
	}

	function closeModal() {
		detailOpen = false;
		selectedUser = null;
	}

	async function saveAll() {
		if (!selectedUser) return;
		saving = true;
		try {
			const [roleResult, statusResult, decisionResult] = await Promise.all([
				trpc.user.updateRole.mutate({ uid: selectedUser.uid, role: editRole }),
				trpc.user.updateStatus.mutate({ uid: selectedUser.uid, status: editStatus }),
				trpc.user.updateDecisions.mutate({
					uid: selectedUser.uid,
					pendingDecision: editPending || null,
					activeDecision: editActive || null
				})
			]);
			const merged = { ...roleResult, ...statusResult, ...decisionResult } as User;
			users = users.map((u) => (u.uid === merged.uid ? { ...u, ...merged } : u));
			closeModal();
			showToast('User saved');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to save'), 'error');
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

<!-- Layout: filters + results. Below md the filter rail becomes a collapsible
     strip stacked on top and the table becomes a card list; from md up it is
     the original sidebar + table. -->
<div class="flex flex-col overflow-hidden rounded-md border border-border bg-white md:flex-row">
	<UserFilters
		collapsible
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

		{#if users.length === 0}
			<div class="py-12 text-center text-[13px] text-muted-foreground">No results</div>
		{:else}
			<!-- Card stack (below md): one tappable card per user, opening the same
			     detail modal the table's Edit button opens. -->
			<div class="transition-opacity md:hidden" class:opacity-50={loadingPage}>
				{#each users as user (user.uid)}
					<button
						type="button"
						onclick={() => openModal(user)}
						class="block w-full cursor-pointer border-b border-border-subtle bg-transparent px-4 py-3 text-left transition-colors hover:bg-surface-hover"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="truncate text-base font-medium text-foreground">{user.name}</div>
								<div class="truncate text-xs text-muted-foreground">{user.email}</div>
							</div>
							<span
								class="shrink-0 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
							>
								{user.role.charAt(0) + user.role.slice(1).toLowerCase()}
							</span>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="text-xs font-semibold tracking-eyebrow text-neutral-700 uppercase">
								{user.status.charAt(0) + user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
							</span>
							{#if user.pendingDecision}
								<span
									class="inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold {DECISION_CLASS[
										user.pendingDecision
									] ?? 'bg-[#e5e7eb] text-[#374151]'}"
								>
									Pending: {decLabel(user.pendingDecision)}
								</span>
							{/if}
							{#if user.activeDecision}
								<span
									class="inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold {DECISION_CLASS[
										user.activeDecision
									] ?? 'bg-[#e5e7eb] text-[#374151]'}"
								>
									{decLabel(user.activeDecision)}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<!-- Scrollable table wrapper (md and up) — unchanged from desktop -->
			<div
				class="hidden max-h-[calc(100vh-280px)] overflow-x-auto overflow-y-auto transition-opacity md:block"
				class:opacity-50={loadingPage}
			>
				<table class="w-full border-collapse">
					<thead>
						<tr class="sticky top-0 z-[1] border-b border-border bg-[#f9f9f9]">
							{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col (col)}
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
									{user.role.charAt(0) + user.role.slice(1).toLowerCase()}
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
			</div>
		{/if}
	</div>
</div>

<!-- Pagination bar -->
{#if totalPages > 1}
	<div
		class="mt-4 flex flex-wrap items-center justify-center gap-2 transition-opacity sm:gap-4"
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

<!-- User detail modal. The shared Modal supplies overlay, focus trap, Escape,
     and a panel that fits a 320px viewport (modal-panel-w caps it below its
     max width with a gutter). -->
<Modal
	bind:open={detailOpen}
	onClose={() => (selectedUser = null)}
	title={selectedUser?.name ?? 'Edit user'}
	description={selectedUser?.email}
	size="lg"
	bodyClass="flex flex-col gap-5"
>
	{#if selectedUser}
		<!-- Info row -->
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			<div>
				<div class="mb-1 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Created
				</div>
				<div class="font-mono text-base text-foreground">
					{formatDate(selectedUser.createdAt)}
				</div>
			</div>
			<div>
				<div class="mb-1 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					UID
				</div>
				<div class="font-mono text-xs break-all text-muted-foreground">
					{selectedUser.uid}
				</div>
			</div>
		</div>

		<!-- Role. Radios, not checkboxes: roles are mutually exclusive, so the control
		     has to make picking a second one *replace* the first rather than add to it.
		     A checkbox group is what let an account be ADMIN and HACKER at once. -->
		<div>
			<div class="mb-2 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
				Role
			</div>
			<div class="flex flex-wrap gap-x-4 gap-y-2.5" role="radiogroup" aria-label="Role">
				{#each ALL_ROLES as role (role)}
					<label class="flex cursor-pointer items-center gap-1.5 text-base text-foreground">
						<input
							type="radio"
							name="edit-role"
							value={role}
							checked={editRole === role}
							onchange={() => (editRole = role)}
							class="cursor-pointer accent-primary"
						/>
						{role.charAt(0) + role.slice(1).toLowerCase()}
					</label>
				{/each}
			</div>
			{#if STAFF_ROLES.includes(editRole) !== STAFF_ROLES.includes(selectedUser.role)}
				<!-- Crossing the staff/attendee line moves the account between portals
				     outright, which is a bigger edit than the control looks like. -->
				<div class="mt-2 text-xs text-muted-foreground">
					{STAFF_ROLES.includes(editRole)
						? 'Saving moves this account into the admin portal and revokes its hacker portal access.'
						: 'Saving moves this account into the hacker portal and revokes its admin portal access.'}
				</div>
			{/if}
		</div>

		<!-- Status + Decisions row: single column on phones, three-up from sm -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Status
				</div>
				<select
					bind:value={editStatus}
					class="w-full cursor-pointer rounded-md border border-border bg-card px-2 py-1.5 text-base text-foreground outline-none"
				>
					{#each ALL_STATUSES as s (s)}
						<option value={s}>{s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}</option>
					{/each}
				</select>
			</div>
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Pending Decision
				</div>
				<select
					bind:value={editPending}
					class="w-full cursor-pointer rounded-md border border-border bg-card px-2 py-1.5 text-base text-foreground outline-none"
				>
					<option value="">None</option>
					{#each DECISION_VALUES as d (d)}
						<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
					{/each}
				</select>
			</div>
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Active Decision
				</div>
				<select
					bind:value={editActive}
					class="w-full cursor-pointer rounded-md border border-border bg-card px-2 py-1.5 text-base text-foreground outline-none"
				>
					<option value="">None</option>
					{#each DECISION_VALUES as d (d)}
						<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="primary" loading={saving} onclick={saveAll}>Save Changes</Button>
	{/snippet}
</Modal>

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
