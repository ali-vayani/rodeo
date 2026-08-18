<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import UserProfile, { type ProfileData } from '$lib/components/admin/UserProfile.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Button, Combobox, Modal } from '$lib/components/ui';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_VALUES,
		DECISION_OPTIONS,
		allChecked,
		buildRecipientParams
	} from '$lib/admin/filters';
	import { linkedFacetKey, type FacetState } from '$lib/facets';
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
			expansion = result.search;
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

	/**
	 * The application-answer facets. Empty means "no filter" — the inverse of the three
	 * checkbox groups, which start fully checked. `buildRecipientParams` omits an empty
	 * facet's key entirely rather than sending `[]`, which the server would read as
	 * "match nobody"; see `facetParams`.
	 */
	let facetSelection = $state<FacetState>({});

	/**
	 * The Name facet has no control of its own — it is one distinct value per person, so
	 * a list of them is a directory — but the did-you-mean chips below the search box
	 * drive it directly, which is why the key is spelled out here.
	 */
	const NAME_FACET = linkedFacetKey('NAME');

	function buildListParams(p: number) {
		return {
			page: p,
			pageSize: PAGE_SIZE,
			...buildRecipientParams(roleFilter, statusFilter, decisionFilter, search, facetSelection)
		};
	}

	// --- Typo-tolerant search ---
	// What the server fell back to when the typed term matched almost nothing. The
	// rows themselves are `createdAt desc` under pagination and are NOT ranked; these
	// names are. See the strip below the search box.
	let expansion = $state(untrack(() => data.search));

	/**
	 * The strip's wording follows `exact` — how many rows the typed term matched on its
	 * own — not `fuzzy`, which only says the fold ran. The fold runs below a floor of
	 * five rather than at zero, so it fires on plenty of terms that did match, and
	 * "No exact match" over a list of exact matches reads as a broken search.
	 */
	let suggestionsLabel = $derived(
		expansion.exact > 0 ? 'Similar names:' : 'No exact match — did you mean:'
	);

	/** The name a did-you-mean chip currently pins the list to, if any. */
	let pinnedName = $derived(
		facetSelection[NAME_FACET]?.values?.length === 1 ? facetSelection[NAME_FACET].values[0] : null
	);

	/**
	 * Narrow to one suggested person — an exact `name` filter, so the result is that
	 * person rather than a differently-ranked list of near-misses. The search term is
	 * left in the box on purpose: the strip stays on screen, so a wrong guess is one
	 * click away from the next candidate.
	 */
	function pickSuggestion(name: string) {
		facetSelection = {
			...facetSelection,
			[NAME_FACET]: { values: pinnedName === name ? [] : [name] }
		};
		loadPage(1);
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

	// `clear` resets a group to its all-ticked "no filter" default. Resetting rather
	// than unticking keeps the boxes truthful: none ticked also means "no filter"
	// (see `buildRecipientParams`), so clearing to empty would show every row above a
	// panel claiming nothing is selected.
	function clearRole() {
		roleFilter = allChecked(ALL_ROLES);
		loadPage(1);
	}
	function clearStatus() {
		statusFilter = allChecked(ALL_STATUSES);
		loadPage(1);
	}
	function clearDecision() {
		decisionFilter = allChecked(DECISION_OPTIONS);
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
	// for the nullable pending decision and is mapped back to null on save.
	//
	// There is no `editActive`: an active decision is one the applicant has already
	// been emailed, so it is shown here but never edited. Changing a published
	// outcome means setting a new pending decision and releasing it, which notifies
	// them — see `user.updateDecisions`, which no longer accepts the field at all.
	let editRole = $state<Role>(Role.UNDECLARED);
	let editStatus = $state<UserStatus>(UserStatus.CREATED);
	let editPending = $state<DecisionStatus | ''>('');
	let saving = $state(false);

	/**
	 * Released — the applicant has been emailed an outcome, so both decision
	 * controls lock. `user.updateDecisions` enforces the same rule server-side.
	 *
	 * Note this currently closes the last editing surface for a released decision:
	 * /admin/admissions loads its queue with `noDecision: true`, which matches only
	 * applicants whose pending AND active decisions are both null, so a released
	 * one never appears there either. `admissions.setDecision` would still accept
	 * the change, but nothing in the UI can reach it.
	 */
	const released = $derived(Boolean(selectedUser?.activeDecision));

	// --- Full profile (user.getById) ---
	// The list row carries only the seven columns the table shows. Everything the
	// person actually submitted is a round trip, so the modal opens immediately on
	// the row data and fills this half in when it lands — opening never waits on
	// the network. `profileToken` is the guard against a slow response for a row
	// you already navigated away from overwriting a fast one for the row you're on.
	let profile = $state<ProfileData | null>(null);
	let profileLoading = $state(false);
	let profileError = $state<string | null>(null);
	let profileToken = 0;

	function openModal(user: User) {
		selectedUser = user;
		editRole = user.role;
		editStatus = user.status;
		editPending = user.pendingDecision ?? '';
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

	async function saveAll() {
		if (!selectedUser) return;
		saving = true;
		try {
			// The decision call is skipped entirely for a released applicant rather than
			// sent and allowed to fail: the server rejects it with a CONFLICT, which
			// would sink the whole Promise.all and lose the role and status edits that
			// were perfectly valid.
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
	 * The `<tr>` deliberately gets no `role="button"` and no `tabindex`: a row of
	 * seven text cells is not a button, and forcing it to announce as one costs a
	 * screen-reader user the column semantics that make the table readable. The
	 * row's keyboard and assistive-tech path is the real `<button>` still sitting
	 * in the last cell — one tab stop per row, exactly as before, now labelled
	 * "Edit {name}" so fifty of them aren't all announced as a bare "Edit". The
	 * label keeps the visible word so voice control ("click Edit") still hits it,
	 * per WCAG 2.5.3. This handler is the pointer affordance layered on top.
	 *
	 * Clicks that finish a text selection are ignored, so highlighting an email
	 * to copy it doesn't open a modal over the top of it.
	 */
	function onRowClick(user: User) {
		if (window.getSelection()?.toString()) return;
		openModal(user);
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
		facets={data.facets}
		bind:selection={facetSelection}
		onSelectionChange={() => loadPage(1)}
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

		<!--
			Suggestion strip. Shown only when the server has names to offer that the typed
			term did not already select — see `suggestionsLabel` for why the wording
			depends on how many rows it did select.

			These names are the one ranked thing on this screen. The rows below are
			`createdAt desc` under pagination — a relevance score computed in application
			memory cannot drive a SQL ORDER BY without breaking skip/take — so the table is
			deliberately left in its own order and the ranking is offered here instead, in
			the order the server sent. Clicking a name applies it as an exact filter, which
			is how you get from "these 14 rows are near-misses" to one person.
		-->
		{#if expansion.fuzzy && expansion.names.length > 0}
			<div
				class="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-muted px-4 py-2.5"
			>
				<span class="text-xs text-foreground-secondary">{suggestionsLabel}</span>
				{#each expansion.names as name (name)}
					<button
						type="button"
						aria-pressed={pinnedName === name}
						onclick={() => pickSuggestion(name)}
						class="max-w-full cursor-pointer truncate rounded-sm border px-2 py-0.5 text-sm
						       transition-colors duration-150 focus-visible:shadow-ring {pinnedName === name
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border bg-card text-foreground hover:bg-surface-hover'}"
					>
						{name}
					</button>
				{/each}
				{#if expansion.capped}
					<!--
						The suggestion list hit its cap, so it is a sample of the close matches
						rather than all of them. A truncated list is a different answer.
					-->
					<span class="text-xs text-foreground-tertiary">
						showing the {expansion.names.length} closest
					</span>
				{/if}
			</div>
		{/if}

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
	onClose={clearSelection}
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
			<!-- Read-only: this is the outcome the applicant has already been emailed.
			     Editing it here would change the record without changing what they were
			     told, so a published decision is altered by setting a new pending one
			     and releasing it. -->
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

		<!-- Everything they submitted. Read-only, and below the editing controls on
		     purpose: a triage edit stays one glance from the top of the panel
		     rather than eleven essay answers down it. -->
		<UserProfile {profile} loading={profileLoading} error={profileError} />
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
