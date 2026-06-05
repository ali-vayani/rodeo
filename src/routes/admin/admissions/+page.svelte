<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import ApplicantList from '$lib/components/admissions/ApplicantList.svelte';
	import ApplicantDetail from '$lib/components/admissions/ApplicantDetail.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Applicant = (typeof data.applicants)[number];

	let applicants = $state<Applicant[]>(untrack(() => [...data.applicants]));
	let selectedUid = $state<string | null>(null);
	let roleTab = $state('ALL');
	let search = $state('');
	let loading = $state(false);
	let decisionLoading = $state(false);
	let sidebarCollapsed = $state(false);

	// Release modal
	let showReleaseModal = $state(false);
	let releaseConfirmText = $state('');
	let releasing = $state(false);

	// Toast
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let selectedIndex = $derived(applicants.findIndex((a) => a.uid === selectedUid));
	let selected = $derived(selectedIndex >= 0 ? applicants[selectedIndex] : null);
	let pendingCount = $derived(applicants.filter((a) => a.pendingDecision !== null).length);
	let hasPrev = $derived(selectedIndex > 0);
	let hasNext = $derived(selectedIndex >= 0 && selectedIndex < applicants.length - 1);

	function selectPrev() {
		if (hasPrev) selectedUid = applicants[selectedIndex - 1].uid;
	}

	function selectNext() {
		if (hasNext) selectedUid = applicants[selectedIndex + 1].uid;
	}

	async function loadApplicants() {
		loading = true;
		try {
			applicants = await trpc.admissions.list.query({
				noDecision: true,
				roles: roleTab !== 'ALL' ? ([roleTab] as any) : undefined,
				search: search.trim() || undefined
			});
		} catch (e: any) {
			showToast(e.message ?? 'Failed to load applicants', 'error');
		} finally {
			loading = false;
		}
	}

	function onRoleTabChange(tab: string) {
		roleTab = tab;
		loadApplicants();
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(value: string) {
		search = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(loadApplicants, 400);
	}

	async function handleDecision(decision: string) {
		if (!selectedUid) return;
		const uid = selectedUid;
		const idx = applicants.findIndex((a) => a.uid === uid);

		decisionLoading = true;
		try {
			await trpc.admissions.setDecision.mutate({ uid, decision: decision as any });

			// Remove from list — they now have a pending decision
			const next = applicants.filter((a) => a.uid !== uid);
			applicants = next;

			// Auto-advance: pick same index (now the next person) or fall back to last
			if (next.length === 0) {
				selectedUid = null;
			} else if (idx < next.length) {
				selectedUid = next[idx].uid;
			} else {
				selectedUid = next[next.length - 1].uid;
			}
		} catch (e: any) {
			showToast(e.message ?? 'Failed to update decision', 'error');
		} finally {
			decisionLoading = false;
		}
	}

	async function handleRelease() {
		releasing = true;
		try {
			const result = await trpc.admissions.release.mutate({});
			applicants = applicants.map((a) => ({
				...a,
				activeDecision: a.pendingDecision ?? a.activeDecision,
				pendingDecision: null
			}));
			showReleaseModal = false;
			releaseConfirmText = '';
			showToast(`Released decisions for ${result.released} user${result.released === 1 ? '' : 's'}`);
		} catch (e: any) {
			showToast(e.message ?? 'Release failed', 'error');
		} finally {
			releasing = false;
		}
	}

	function openReleaseModal() {
		releaseConfirmText = '';
		showReleaseModal = true;
	}

	function closeReleaseModal() {
		if (releasing) return;
		showReleaseModal = false;
		releaseConfirmText = '';
	}
</script>

<!-- Page header -->
<div class="flex items-center justify-between mb-4">
	<div>
		<h1 class="text-[22px] font-bold text-primary">Admissions</h1>
		<span class="text-[13px] text-muted-foreground mt-0.5 block">
			{applicants.length} remaining · {pendingCount} pending review
		</span>
	</div>
	<button
		onclick={openReleaseModal}
		class="text-[13px] font-semibold text-white bg-destructive border-none rounded-md py-[9px] px-[18px] cursor-pointer"
	>
		Release Decisions
	</button>
</div>

<!-- Split pane -->
<div class="flex bg-white border border-border rounded-md overflow-hidden h-[calc(100vh-136px)]">
	<ApplicantList
		{applicants}
		{selectedUid}
		onSelect={(uid) => (selectedUid = uid)}
		{roleTab}
		{onRoleTabChange}
		{search}
		{onSearchInput}
		{loading}
		collapsed={sidebarCollapsed}
		onToggleCollapse={() => (sidebarCollapsed = !sidebarCollapsed)}
	/>

	<!-- Right detail pane -->
	<div class="flex-1 overflow-hidden flex flex-col min-w-0">
		{#if selected}
			<ApplicantDetail
				applicant={selected}
				onDecision={handleDecision}
				decisionLoading={decisionLoading}
				{hasPrev}
				{hasNext}
				onPrev={selectPrev}
				onNext={selectNext}
			/>
		{:else}
			<div class="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
				{applicants.length === 0
					? 'All applicants have been reviewed'
					: 'Select an applicant to review their application'}
			</div>
		{/if}
	</div>
</div>

<!-- Release Decisions modal -->
{#if showReleaseModal}
	<div
		role="presentation"
		onclick={closeReleaseModal}
		class="fixed inset-0 bg-black/45 z-[100] flex items-center justify-center"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Release decisions"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeReleaseModal()}
			class="bg-white rounded-lg w-[480px] max-w-[calc(100vw-48px)] shadow-[0_8px_32px_rgba(0,0,0,0.18)] overflow-hidden"
		>
			<!-- Header -->
			<div class="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between">
				<div>
					<div class="text-[16px] font-bold text-primary">Release Decisions</div>
					<div class="text-[13px] text-muted-foreground mt-1">
						This will copy all pending decisions to active decisions and send notification emails.
					</div>
				</div>
				<button
					onclick={closeReleaseModal}
					class="text-xl leading-none bg-transparent border-none text-muted-foreground cursor-pointer p-0 -mt-0.5"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Body -->
			<div class="px-6 py-5">
				<div class="bg-[#fff3f3] border border-[#fca5a5] rounded px-[14px] py-3 mb-5">
					<div class="text-[13px] font-semibold text-destructive mb-1">
						{pendingCount} user{pendingCount === 1 ? '' : 's'} will be affected
					</div>
					<div class="text-xs text-[#666]">
						Emails will be sent for all accepted, rejected, and waitlisted decisions. This action
						cannot be undone.
					</div>
				</div>

				<div class="mb-4">
					<label
						for="release-confirm"
						class="block text-xs font-semibold text-[#333] mb-1.5"
					>
						Type <span class="font-mono bg-[#f0f0f0] px-[5px] py-px rounded">RELEASE</span> to confirm
					</label>
					<input
						id="release-confirm"
						type="text"
						bind:value={releaseConfirmText}
						placeholder="RELEASE"
						class="w-full text-[13px] text-primary bg-white border border-border rounded px-3 py-2 outline-none font-mono"
					/>
				</div>
			</div>

			<!-- Footer -->
			<div class="px-6 py-4 border-t border-border flex justify-end gap-[10px]">
				<button
					onclick={closeReleaseModal}
					disabled={releasing}
					class="text-[13px] font-medium text-primary bg-white border border-border rounded-md py-2 px-4 cursor-pointer"
					class:opacity-50={releasing}
				>
					Cancel
				</button>
				<button
					onclick={handleRelease}
					disabled={releaseConfirmText !== 'RELEASE' || releasing || pendingCount === 0}
					class="text-[13px] font-semibold text-white bg-destructive border-none rounded-md py-2 px-[18px] cursor-pointer"
					class:opacity-40={releaseConfirmText !== 'RELEASE' || releasing || pendingCount === 0}
				>
					{releasing
						? 'Releasing…'
						: `Release ${pendingCount} Decision${pendingCount === 1 ? '' : 's'}`}
				</button>
			</div>
		</div>
	</div>
{/if}

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
