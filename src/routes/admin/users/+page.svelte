<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';

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
	const ALL_ROLES = ['HACKER', 'JUDGE', 'MENTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN', 'UNDECLARED'];
	const ALL_STATUSES = ['CREATED', 'APPLIED', 'CONFIRMED', 'DECLINED', 'CHECKED_IN'];
	const ALL_DECISIONS = ['ACCEPTED', 'WAITLISTED', 'REJECTED', 'PENDING', 'NONE'];
	const DECISION_VALUES = ['ACCEPTED', 'WAITLISTED', 'REJECTED', 'PENDING'];

	let roleFilter = $state(Object.fromEntries(ALL_ROLES.map((r) => [r, true])));
	let statusFilter = $state(Object.fromEntries(ALL_STATUSES.map((s) => [s, true])));
	let decisionFilter = $state(Object.fromEntries(ALL_DECISIONS.map((d) => [d, true])));
	let search = $state('');

	// Build tRPC list params from current filter state.
	// When everything is checked (default), we pass undefined so the server skips that filter.
	function buildListParams(p: number) {
		const selRoles = ALL_ROLES.filter((r) => roleFilter[r]);
		const selStatuses = ALL_STATUSES.filter((s) => statusFilter[s]);
		const selDecisions = DECISION_VALUES.filter((d) => decisionFilter[d]);
		const noneChecked = decisionFilter['NONE'] ?? true;
		const allDecDefault =
			selDecisions.length === DECISION_VALUES.length && noneChecked;

		return {
			page: p,
			pageSize: PAGE_SIZE,
			search: search.trim() || undefined,
			roles: selRoles.length < ALL_ROLES.length ? (selRoles as any) : undefined,
			statuses: selStatuses.length < ALL_STATUSES.length ? (selStatuses as any) : undefined,
			decisions: allDecDefault ? undefined : (selDecisions as any),
			includeNoDecision: allDecDefault ? undefined : noneChecked
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
		decisionFilter = Object.fromEntries(ALL_DECISIONS.map((d) => [d, false]));
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
	const DECISION_BG: Record<string, string> = {
		ACCEPTED: '#d1fae5',
		WAITLISTED: '#fef9c3',
		REJECTED: '#fee2e2',
		PENDING: '#e5e7eb'
	};
	const DECISION_FG: Record<string, string> = {
		ACCEPTED: '#065f46',
		WAITLISTED: '#713f12',
		REJECTED: '#991b1b',
		PENDING: '#374151'
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
<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
	<h1 style="font-size:22px; font-weight:700; color:#191919; margin:0;">Users</h1>
	<button
		onclick={exportCsv}
		disabled={exporting}
		style="font-size:13px; font-weight:500; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:7px 14px; cursor:pointer; opacity:{exporting
			? 0.6
			: 1};"
	>
		{exporting ? 'Exporting…' : 'Export CSV'}
	</button>
</div>

<!-- Layout: filter sidebar + table area -->
<div
	style="display:flex; background:#fff; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden;"
>
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
	<div style="flex:1; min-width:0; display:flex; flex-direction:column;">
		<!-- Search + count bar -->
		<div
			style="display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid #e0e0e0;"
		>
			<input
				type="text"
				placeholder="Search by name or email…"
				bind:value={search}
				oninput={onSearchInput}
				style="flex:1; font-size:13px; color:#191919; background:#f9f9f9; border:1px solid #e0e0e0; border-radius:5px; padding:7px 12px; outline:none;"
			/>
			<span style="font-size:12px; color:#aaaaaa; white-space:nowrap;">
				{total} total
			</span>
		</div>

		<!-- Scrollable table wrapper -->
		<div
			style="overflow-x:auto; overflow-y:auto; max-height:calc(100vh - 280px); opacity:{loadingPage
				? 0.5
				: 1}; transition:opacity 0.15s;"
		>
			{#if users.length === 0}
				<div style="padding:48px; text-align:center; font-size:13px; color:#aaaaaa;">
					No results
				</div>
			{:else}
				<table style="width:100%; border-collapse:collapse;">
					<thead>
						<tr
							style="border-bottom:1px solid #e0e0e0; position:sticky; top:0; z-index:1; background:#f9f9f9;"
						>
							{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col}
								<th
									style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa; white-space:nowrap; background:#f9f9f9;"
								>
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.uid)}
							<tr
								style="border-bottom:1px solid #f0f0f0; transition:background 0.1s;"
								onmouseenter={(e) =>
									((e.currentTarget as HTMLElement).style.background = '#fafafa')}
								onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}
							>
								<td
									style="padding:11px 14px; font-size:13px; font-weight:500; color:#191919; white-space:nowrap;"
								>
									{user.name}
								</td>
								<td style="padding:11px 14px; font-size:12px; color:#aaaaaa;">
									{user.email}
								</td>
								<td style="padding:11px 14px; font-size:13px; color:#333;">
									{#if user.roles.length}
										{user.roles[0].charAt(0) + user.roles[0].slice(1).toLowerCase()}
									{:else}
										—
									{/if}
								</td>
								<td style="padding:11px 14px;">
									<span
										style="font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:#555;"
									>
										{user.status.charAt(0) +
											user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
									</span>
								</td>
								<td style="padding:11px 14px;">
									{#if user.pendingDecision}
										<span
											style="display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[user.pendingDecision] ??
												'#e5e7eb'}; color:{DECISION_FG[user.pendingDecision] ?? '#374151'};"
										>
											{decLabel(user.pendingDecision)}
										</span>
									{:else}
										<span style="font-size:12px; color:#cccccc;">—</span>
									{/if}
								</td>
								<td style="padding:11px 14px;">
									{#if user.activeDecision}
										<span
											style="display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[user.activeDecision] ??
												'#e5e7eb'}; color:{DECISION_FG[user.activeDecision] ?? '#374151'};"
										>
											{decLabel(user.activeDecision)}
										</span>
									{:else}
										<span style="font-size:12px; color:#cccccc;">—</span>
									{/if}
								</td>
								<td
									style="padding:11px 14px; font-size:12px; color:#aaaaaa; font-family:'DM Mono', monospace; white-space:nowrap;"
								>
									{formatDate(user.createdAt)}
								</td>
								<td style="padding:11px 14px;">
									<button
										onclick={() => openModal(user)}
										style="font-size:12px; color:#191919; background:none; border:1px solid #e0e0e0; border-radius:4px; padding:4px 10px; cursor:pointer;"
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
		style="display:flex; align-items:center; justify-content:center; gap:16px; margin-top:16px; opacity:{loadingPage
			? 0.5
			: 1}; transition:opacity 0.15s; pointer-events:{loadingPage ? 'none' : 'auto'};"
	>
		<button
			onclick={() => loadPage(page - 1)}
			disabled={page <= 1 || loadingPage}
			style="font-size:13px; font-weight:500; color:{page <= 1
				? '#cccccc'
				: '#191919'}; background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:7px 14px; cursor:{page <=
			1
				? 'default'
				: 'pointer'};"
		>
			← Previous
		</button>

		<span
			style="font-size:13px; color:#aaaaaa; font-family:'DM Mono', monospace; white-space:nowrap;"
		>
			{loadingPage ? 'Loading…' : `Page ${page} of ${totalPages}`}
		</span>

		<button
			onclick={() => loadPage(page + 1)}
			disabled={page >= totalPages || loadingPage}
			style="font-size:13px; font-weight:500; color:{page >= totalPages
				? '#cccccc'
				: '#191919'}; background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:7px 14px; cursor:{page >=
			totalPages
				? 'default'
				: 'pointer'};"
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
		style="position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; display:flex; align-items:center; justify-content:center;"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Edit user"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeModal()}
			style="background:#fff; border-radius:8px; width:560px; max-width:calc(100vw - 48px); max-height:calc(100vh - 80px); overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,0.18); display:flex; flex-direction:column;"
		>
			<!-- Header -->
			<div
				style="display:flex; align-items:flex-start; justify-content:space-between; padding:20px 24px 16px; border-bottom:1px solid #e0e0e0; flex-shrink:0;"
			>
				<div>
					<div style="font-size:17px; font-weight:700; color:#191919;">{selectedUser.name}</div>
					<div style="font-size:12px; color:#aaaaaa; margin-top:2px;">{selectedUser.email}</div>
				</div>
				<button
					onclick={closeModal}
					style="font-size:20px; line-height:1; background:none; border:none; color:#aaaaaa; cursor:pointer; padding:0; margin-top:-2px;"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Info row -->
			<div style="padding:16px 24px; border-bottom:1px solid #f0f0f0;">
				<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
					<div>
						<div
							style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
						>
							Created
						</div>
						<div style="font-size:13px; color:#333; font-family:'DM Mono', monospace;">
							{formatDate(selectedUser.createdAt)}
						</div>
					</div>
					<div>
						<div
							style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
						>
							UID
						</div>
						<div
							style="font-size:11px; color:#aaaaaa; font-family:'DM Mono', monospace; word-break:break-all;"
						>
							{selectedUser.uid}
						</div>
					</div>
				</div>
			</div>

			<!-- Edit fields -->
			<div style="padding:20px 24px; display:flex; flex-direction:column; gap:20px;">
				<!-- Roles -->
				<div>
					<div
						style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:10px;"
					>
						Roles
					</div>
					<div style="display:flex; flex-wrap:wrap; gap:10px 16px;">
						{#each ALL_ROLES as role}
							<label
								style="display:flex; align-items:center; gap:6px; font-size:13px; color:#333; cursor:pointer;"
							>
								<input
									type="checkbox"
									checked={editRoles.includes(role)}
									onchange={() => toggleEditRole(role)}
									style="accent-color:#191919; cursor:pointer;"
								/>
								{role.charAt(0) + role.slice(1).toLowerCase()}
							</label>
						{/each}
					</div>
				</div>

				<!-- Status + Decisions row -->
				<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
					<div>
						<div
							style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:6px;"
						>
							Status
						</div>
						<select
							bind:value={editStatus}
							style="width:100%; font-size:13px; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:5px; padding:6px 8px; cursor:pointer; outline:none;"
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
							style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:6px;"
						>
							Pending Decision
						</div>
						<select
							bind:value={editPending}
							style="width:100%; font-size:13px; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:5px; padding:6px 8px; cursor:pointer; outline:none;"
						>
							<option value="">None</option>
							{#each DECISION_VALUES as d}
								<option value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
							{/each}
						</select>
					</div>
					<div>
						<div
							style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:6px;"
						>
							Active Decision
						</div>
						<select
							bind:value={editActive}
							style="width:100%; font-size:13px; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:5px; padding:6px 8px; cursor:pointer; outline:none;"
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
			<div
				style="padding:16px 24px; border-top:1px solid #e0e0e0; display:flex; justify-content:flex-end; flex-shrink:0;"
			>
				<button
					onclick={saveAll}
					disabled={saving}
					style="font-size:13px; font-weight:600; color:#fff; background:#191919; border:none; border-radius:6px; padding:9px 20px; cursor:pointer; opacity:{saving
						? 0.6
						: 1};"
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
		style="position:fixed; bottom:28px; right:28px; z-index:200;"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
