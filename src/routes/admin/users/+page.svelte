<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import type { PageData } from './$types';
	import { onDestroy, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import UserProfile, { type ProfileData } from '$lib/components/admin/UserProfile.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Button, Checkbox, Combobox, Modal, Spinner } from '$lib/components/ui';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_VALUES,
		DECISION_OPTIONS,
		allChecked,
		allCleared,
		buildRecipientParams
	} from '$lib/admin/filters';
	import { USER_EXPORT_COLUMNS, USER_EXPORT_COLUMN_LABELS } from '$lib/admin/exportColumns';
	import type { FacetState } from '$lib/facets';
	import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import { STAFF_ROLES } from '$lib/auth/permissions';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type User = (typeof data.users)[number];

	let users = $state<User[]>(untrack(() => [...data.users]));
	let total = $state(untrack(() => data.total));
	let page = $state(1);
	const PAGE_SIZE = untrack(() => data.pageSize);
	let totalPages = $derived(Math.ceil(total / PAGE_SIZE));
	let loadingPage = $state(false);

	let listRequest = 0;

	async function loadPage(p: number) {
		clearTimeout(searchTimer);
		const request = ++listRequest;
		loadingPage = true;
		try {
			const result = await trpc.user.list.query(buildListParams(p));
			if (request !== listRequest) return;
			users = result.users;
			total = result.total;
			page = p;
		} catch (e) {
			if (request === listRequest) showToast(errorMessage(e, 'Failed to load page'), 'error');
		} finally {
			if (request === listRequest) loadingPage = false;
		}
	}

	// Vocabulary and the checkbox-state to tRPC-params translation are shared with the
	// custom-email wizard, so a count here and a send there cannot disagree.
	let roleFilter = $state(allChecked(ALL_ROLES));
	let statusFilter = $state(allChecked(ALL_STATUSES));
	let decisionFilter = $state(allChecked(DECISION_OPTIONS));
	let pendingFilter = $state(allChecked(DECISION_OPTIONS));
	let search = $state('');

	/**
	 * The application-answer facets. Empty means "no filter", the inverse of the three
	 * checkbox groups, which start fully checked. `buildRecipientParams` omits an empty
	 * facet's key rather than sending `[]`, which the server reads as "match nobody".
	 */
	let facetSelection = $state<FacetState>({});

	function buildListParams(p: number) {
		return {
			page: p,
			pageSize: PAGE_SIZE,
			...buildRecipientParams(
				roleFilter,
				statusFilter,
				decisionFilter,
				pendingFilter,
				search,
				facetSelection
			)
		};
	}

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
	function togglePending(d: string) {
		pendingFilter = { ...pendingFilter, [d]: !pendingFilter[d] };
		loadPage(1);
	}

	// `clear` resets a group to its all-ticked "no filter" default. None ticked also
	// means "no filter", so clearing to empty would show every row above a panel
	// claiming nothing is selected.
	function clearRole() {
		roleFilter = allCleared(ALL_ROLES);
		loadPage(1);
	}
	function clearStatus() {
		statusFilter = allCleared(ALL_STATUSES);
		loadPage(1);
	}
	function clearDecision() {
		decisionFilter = allCleared(DECISION_OPTIONS);
		loadPage(1);
	}
	function clearPending() {
		pendingFilter = allCleared(DECISION_OPTIONS);
		loadPage(1);
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		// Invalidate pending results as soon as typing resumes, before the debounce ends.
		listRequest++;
		loadingPage = true;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => loadPage(1), 400);
	}

	function downloadCsv(csv: string, filename: string) {
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	onDestroy(() => {
		clearTimeout(searchTimer);
		listRequest++;
	});

	let exportingAll = $state(false);

	/** The plain, one-click export: every user, every field, no dialog. */
	async function exportAllCsv() {
		exportingAll = true;
		try {
			const csv = await trpc.user.exportCsv.query();
			downloadCsv(csv, 'users.csv');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to export CSV'), 'error');
		} finally {
			exportingAll = false;
		}
	}

	// --- Custom export dialog: pick which rows and which columns go in the file. ---

	let exportModalOpen = $state(false);
	let exportColumnSelection = $state<Record<string, boolean>>(allChecked(USER_EXPORT_COLUMNS));

	type ExportQuestion = { id: string; title: string };
	let exportQuestions = $state<ExportQuestion[]>([]);
	let exportQuestionSelection = $state<Record<string, boolean>>({});
	let exportQuestionsLoading = $state(false);

	let exporting = $state(false);

	/**
	 * The question list is fetched once, lazily, rather than loaded with the rest of the
	 * page: it is only ever needed once an admin opens the export dialog.
	 */
	async function openExportModal() {
		exportModalOpen = true;
		if (exportQuestions.length > 0 || exportQuestionsLoading) return;
		exportQuestionsLoading = true;
		try {
			const questions = await trpc.questions.listAll.query();
			exportQuestions = questions;
			exportQuestionSelection = allChecked(questions.map((q) => q.id));
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load application questions'), 'error');
		} finally {
			exportQuestionsLoading = false;
		}
	}

	function toggleExportColumn(key: string) {
		exportColumnSelection = { ...exportColumnSelection, [key]: !exportColumnSelection[key] };
	}
	function toggleExportQuestion(id: string) {
		exportQuestionSelection = { ...exportQuestionSelection, [id]: !exportQuestionSelection[id] };
	}
	function setAllExportColumns(value: boolean) {
		exportColumnSelection = Object.fromEntries(USER_EXPORT_COLUMNS.map((c) => [c, value]));
	}
	function setAllExportQuestions(value: boolean) {
		exportQuestionSelection = Object.fromEntries(exportQuestions.map((q) => [q.id, value]));
	}

	let selectedExportColumns = $derived(USER_EXPORT_COLUMNS.filter((c) => exportColumnSelection[c]));
	let selectedExportQuestions = $derived(
		exportQuestions.filter((q) => exportQuestionSelection[q.id])
	);
	let exportNothingSelected = $derived(
		selectedExportColumns.length === 0 && selectedExportQuestions.length === 0
	);

	async function runExport() {
		exporting = true;
		try {
			const csv = await trpc.user.exportCsv.query({
				columns: [...selectedExportColumns],
				questionIds: selectedExportQuestions.map((q) => q.id)
			});
			downloadCsv(csv, 'users.csv');
			exportModalOpen = false;
		} catch (e) {
			showToast(errorMessage(e, 'Failed to export CSV'), 'error');
		} finally {
			exporting = false;
		}
	}

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let detailOpen = $state(false);
	let selectedUser = $state<User | null>(null);
	// Typed as the enums rather than plain strings; '' is the modal's own "unset" for the
	// nullable pending decision and is mapped back to null on save.
	//
	// There is no `editActive`: an active decision has already been emailed, so it is
	// shown but never edited. Changing a published outcome means setting a new pending
	// decision and releasing it.
	let editRole = $state<Role>(Role.UNDECLARED);
	let editStatus = $state<UserStatus>(UserStatus.CREATED);
	let editPending = $state<DecisionStatus | ''>('');
	let editNotes = $state('');
	let saving = $state(false);
	let savingNotes = $state(false);

	/**
	 * Released means the applicant has been emailed an outcome, so both decision controls
	 * lock. `user.updateDecisions` enforces the same rule server-side.
	 *
	 * This currently closes the last editing surface for a released decision:
	 * /admin/admissions loads its queue with `noDecision: true`, so a released one never
	 * appears there either.
	 */
	const released = $derived(Boolean(selectedUser?.activeDecision));

	// The list row carries only the seven columns the table shows, so the modal opens
	// immediately on row data and fills this half in when it lands. `profileToken` stops
	// a slow response for an old row overwriting a fast one for the row you are on.
	let profile = $state<ProfileData | null>(null);
	let profileLoading = $state(false);
	let profileError = $state<string | null>(null);
	let profileToken = 0;

	function openModal(user: User) {
		selectedUser = user;
		editRole = user.role;
		editStatus = user.status;
		editPending = user.pendingDecision ?? '';
		editNotes = user.notes ?? '';
		detailOpen = true;
		loadProfile(user.uid);
	}

	async function loadProfile(uid: string) {
		const token = ++profileToken;
		profile = null;
		profileError = null;
		profileLoading = true;
		try {
			const result = await trpc.user.getById.query({ uid });
			if (token !== profileToken) return;
			profile = result;
		} catch (e) {
			if (token !== profileToken) return;
			profileError = errorMessage(e, 'Failed to load this profile');
		} finally {
			if (token === profileToken) profileLoading = false;
		}
	}

	function closeModal() {
		detailOpen = false;
		clearSelection();
	}

	/** Shared by closeModal and the Modal's own dismissals (Escape, backdrop, ✕). */
	function clearSelection() {
		selectedUser = null;
		profile = null;
		profileError = null;
		profileLoading = false;
		// Invalidate any in-flight fetch so it can't repopulate a closed modal.
		profileToken++;
	}

	async function saveNotes() {
		if (!selectedUser) return;
		savingNotes = true;
		try {
			const updated = await trpc.user.updateNotes.mutate({
				uid: selectedUser.uid,
				notes: editNotes
			});
			users = users.map((u) => (u.uid === updated.uid ? { ...u, notes: updated.notes } : u));
			showToast('Notes saved');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to save notes'), 'error');
		} finally {
			savingNotes = false;
		}
	}

	async function saveAll() {
		if (!selectedUser) return;
		saving = true;
		try {
			// The decision call is skipped entirely for a released applicant rather than sent
			// and allowed to fail. The server rejects it with a CONFLICT, which would sink the
			// whole Promise.all and lose the valid role and status edits.
			const [roleResult, statusResult, decisionResult] = await Promise.all([
				trpc.user.updateRole.mutate({ uid: selectedUser.uid, role: editRole }),
				trpc.user.updateStatus.mutate({ uid: selectedUser.uid, status: editStatus }),
				released
					? null
					: trpc.user.updateDecisions.mutate({
							uid: selectedUser.uid,
							pendingDecision: editPending || null
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

	/**
	 * Whole-row click, for pointer users only.
	 *
	 * The `<tr>` deliberately gets no `role="button"` and no `tabindex`. A row of seven
	 * text cells is not a button, and forcing it to announce as one costs a screen-reader
	 * user the column semantics that make the table readable. The keyboard path is the
	 * real `<button>` in the last cell, labelled "Edit {name}" so fifty of them are not
	 * all announced as a bare "Edit". The label keeps the visible word so voice control
	 * still hits it, per WCAG 2.5.3.
	 *
	 * Clicks that finish a text selection are ignored, so highlighting an email to copy
	 * it does not open a modal over the top of it.
	 */
	function onRowClick(user: User) {
		if (window.getSelection()?.toString()) return;
		openModal(user);
	}

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

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Users</h1>
	<div class="flex items-center gap-2">
		<button
			onclick={openExportModal}
			title="Pick which rows and columns to include"
			class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium text-primary"
		>
			Filter CSV
		</button>
		<button
			onclick={exportAllCsv}
			disabled={exportingAll}
			title="Export every user and every field, including application answers"
			class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[7px] text-[13px] font-medium text-primary"
			class:opacity-60={exportingAll}
		>
			{exportingAll ? 'Exporting…' : 'Export All'}
		</button>
	</div>
</div>

<!-- Below md the filter rail becomes a collapsible strip stacked on top and the table
     becomes a card list; from md up it is a sidebar beside a table. -->
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
		{pendingFilter}
		onTogglePending={togglePending}
		onClearPending={clearPending}
		facets={data.facets}
		bind:selection={facetSelection}
		onSelectionChange={() => loadPage(1)}
	/>

	<div class="flex min-w-0 flex-1 flex-col">
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
			<div class="py-12 text-center text-base text-muted-foreground">No results</div>
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
								<div class="truncate text-sm text-muted-foreground">{user.email}</div>
							</div>
							<span
								class="shrink-0 font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
							>
								{user.role.charAt(0) + user.role.slice(1).toLowerCase()}
							</span>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
							<span
								class="font-mono text-2xs font-semibold tracking-eyebrow text-neutral-700 uppercase"
							>
								{user.status.charAt(0) + user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
							</span>
							{#if user.pendingDecision}
								<span
									class="inline-block rounded-sm px-1.5 py-0.5 font-mono text-2xs font-semibold {DECISION_CLASS[
										user.pendingDecision
									] ?? 'bg-[#e5e7eb] text-[#374151]'}"
								>
									Pending: {decLabel(user.pendingDecision)}
								</span>
							{/if}
							{#if user.activeDecision}
								<span
									class="inline-block rounded-sm px-1.5 py-0.5 font-mono text-2xs font-semibold {DECISION_CLASS[
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

			<div
				class="hidden max-h-[calc(100vh-280px)] overflow-x-auto overflow-y-auto transition-opacity md:block"
				class:opacity-50={loadingPage}
			>
				<table class="w-full border-collapse">
					<thead>
						<tr class="sticky top-0 z-[1] border-b border-border bg-[#f9f9f9]">
							{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col (col)}
								<th
									class="bg-[#f9f9f9] px-[14px] py-[10px] text-left font-mono text-2xs font-semibold tracking-eyebrow whitespace-nowrap text-muted-foreground uppercase"
								>
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.uid)}
							<tr
								onclick={() => onRowClick(user)}
								class="cursor-pointer border-b border-[#f0f0f0] transition-colors hover:bg-[#fafafa]"
							>
								<td
									class="px-[14px] py-[11px] text-base font-medium whitespace-nowrap text-primary"
								>
									{user.name}
								</td>
								<td class="px-[14px] py-[11px] text-sm text-muted-foreground">
									{user.email}
								</td>
								<td class="px-[14px] py-[11px] text-base text-[#333]">
									{user.role.charAt(0) + user.role.slice(1).toLowerCase()}
								</td>
								<td class="px-[14px] py-[11px]">
									<span
										class="font-mono text-2xs font-semibold tracking-eyebrow text-[#555] uppercase"
									>
										{user.status.charAt(0) + user.status.slice(1).toLowerCase().replace(/_/g, ' ')}
									</span>
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.pendingDecision}
										<span
											class="inline-block rounded px-[7px] py-0.5 font-mono text-2xs font-semibold {DECISION_CLASS[
												user.pendingDecision
											] ?? 'bg-[#e5e7eb] text-[#374151]'}"
										>
											{decLabel(user.pendingDecision)}
										</span>
									{:else}
										<span class="font-mono text-2xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td class="px-[14px] py-[11px]">
									{#if user.activeDecision}
										<span
											class="inline-block rounded px-[7px] py-0.5 font-mono text-2xs font-semibold {DECISION_CLASS[
												user.activeDecision
											] ?? 'bg-[#e5e7eb] text-[#374151]'}"
										>
											{decLabel(user.activeDecision)}
										</span>
									{:else}
										<span class="font-mono text-2xs text-[#cccccc]">—</span>
									{/if}
								</td>
								<td
									class="px-[14px] py-[11px] font-mono text-sm whitespace-nowrap text-muted-foreground"
								>
									{formatDate(user.createdAt)}
								</td>
								<td class="px-[14px] py-[11px]">
									<!-- The row's keyboard path. stopPropagation so activating it doesn't
									     also run the row handler and fire the profile fetch twice. -->
									<button
										onclick={(e) => {
											e.stopPropagation();
											openModal(user);
										}}
										aria-label="Edit {user.name}"
										class="cursor-pointer rounded border border-border bg-transparent px-[10px] py-1 text-sm text-primary focus-visible:shadow-ring"
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

<!-- User detail modal. The shared Modal supplies overlay, focus trap, Escape, and a
     panel that fits a 320px viewport. -->
<Modal
	bind:open={detailOpen}
	onClose={clearSelection}
	title={selectedUser?.name ?? 'Edit user'}
	description={selectedUser?.email}
	size="lg"
	bodyClass="flex flex-col gap-5"
>
	{#if selectedUser}
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			<div>
				<div class="mb-1 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Created
				</div>
				<div class="font-mono text-base text-foreground">
					{formatDate(selectedUser.createdAt)}
				</div>
			</div>
		</div>

		<!-- Role. Radios, not checkboxes: roles are mutually exclusive, so picking a second
		     one has to replace the first rather than add to it. -->
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

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Status
				</div>
				<Combobox
					bind:value={editStatus}
					options={ALL_STATUSES.map((s) => ({
						value: s,
						label: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
					}))}
					ariaLabel="Status"
				/>
			</div>
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Pending Decision
				</div>
				<Combobox
					bind:value={editPending}
					disabled={released}
					placeholder="None"
					clearable
					options={DECISION_VALUES.map((d) => ({
						value: d,
						label: d.charAt(0) + d.slice(1).toLowerCase()
					}))}
					ariaLabel="Pending decision"
				/>
				{#if released}
					<div class="mt-1 text-2xs text-muted-foreground">Released</div>
				{/if}
			</div>
			<!-- Read-only: this is the outcome the applicant has already been emailed. A
			     published decision is altered by setting a new pending one and releasing it. -->
			<div>
				<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
					Active Decision
				</div>
				<div
					class="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-base text-muted-foreground"
				>
					{selectedUser.activeDecision ? decLabel(selectedUser.activeDecision) : 'None'}
				</div>
				<div class="mt-1 text-2xs text-muted-foreground">Set by releasing decisions</div>
			</div>
		</div>

		<!-- Admin notes: freeform per-user annotations visible only to admins. -->
		<div>
			<div class="mb-1.5 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
				Admin Notes
			</div>
			<textarea
				bind:value={editNotes}
				placeholder="Add notes about this user…"
				rows={4}
				maxlength={5000}
				class="w-full resize-y rounded-md border border-border bg-muted px-3 py-2.5 text-base text-foreground outline-none placeholder:text-foreground-tertiary focus:border-primary focus:bg-white"
			></textarea>
			<div class="mt-2">
				<Button variant="secondary" loading={savingNotes} onclick={saveNotes}>Save Notes</Button>
			</div>
		</div>

		<!-- Everything they submitted. Read-only, and below the editing controls so a triage
		     edit stays one glance from the top rather than eleven essay answers down. -->
		<UserProfile {profile} loading={profileLoading} error={profileError} />
	{/if}

	{#snippet footer()}
		<Button variant="primary" loading={saving} onclick={saveAll}>Save Changes</Button>
	{/snippet}
</Modal>

<!-- Export dialog: which rows and which columns. Both start fully selected, since the
     common case is "everything" and narrowing is the exception. -->
<Modal
	bind:open={exportModalOpen}
	title="Export CSV"
	description="Choose which columns to include in the file."
	size="lg"
	bodyClass="flex flex-col gap-5"
>
	<div>
		<div class="mb-2 flex items-center justify-between">
			<div class="text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
				User fields
			</div>
			<div class="flex gap-3 text-xs text-primary">
				<button
					type="button"
					class="cursor-pointer border-none bg-transparent p-0 underline"
					onclick={() => setAllExportColumns(true)}
				>
					Select all
				</button>
				<button
					type="button"
					class="cursor-pointer border-none bg-transparent p-0 underline"
					onclick={() => setAllExportColumns(false)}
				>
					Clear
				</button>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
			{#each USER_EXPORT_COLUMNS as column (column)}
				<Checkbox
					checked={exportColumnSelection[column] ?? false}
					onCheckedChange={() => toggleExportColumn(column)}
					label={USER_EXPORT_COLUMN_LABELS[column]}
				/>
			{/each}
		</div>
	</div>

	<div>
		<div class="mb-2 flex items-center justify-between">
			<div class="text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
				Application questions
			</div>
			{#if exportQuestions.length > 0}
				<div class="flex gap-3 text-xs text-primary">
					<button
						type="button"
						class="cursor-pointer border-none bg-transparent p-0 underline"
						onclick={() => setAllExportQuestions(true)}
					>
						Select all
					</button>
					<button
						type="button"
						class="cursor-pointer border-none bg-transparent p-0 underline"
						onclick={() => setAllExportQuestions(false)}
					>
						Clear
					</button>
				</div>
			{/if}
		</div>
		{#if exportQuestionsLoading}
			<div class="flex items-center gap-2 py-2 text-sm text-foreground-secondary">
				<Spinner label="" />
				Loading questions…
			</div>
		{:else if exportQuestions.length === 0}
			<div class="text-sm text-muted-foreground">No application questions.</div>
		{:else}
			<div class="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
				{#each exportQuestions as question (question.id)}
					<Checkbox
						checked={exportQuestionSelection[question.id] ?? false}
						onCheckedChange={() => toggleExportQuestion(question.id)}
						label={question.title}
					/>
				{/each}
			</div>
		{/if}
	</div>

	{#if exportNothingSelected}
		<div class="text-xs text-danger-700">Select at least one field or question to export.</div>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (exportModalOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			loading={exporting}
			disabled={exportNothingSelected}
			onclick={runExport}
		>
			Export
		</Button>
	{/snippet}
</Modal>

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
