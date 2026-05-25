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
<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
	<div>
		<h1 style="font-size:22px; font-weight:700; color:#191919; margin:0;">Admissions</h1>
		<span style="font-size:13px; color:#aaaaaa; margin-top:2px; display:block;">
			{applicants.length} remaining · {pendingCount} pending review
		</span>
	</div>
	<button
		onclick={openReleaseModal}
		style="font-size:13px; font-weight:600; color:#fff; background:#b00000; border:none; border-radius:6px; padding:9px 18px; cursor:pointer;"
	>
		Release Decisions
	</button>
</div>

<!-- Split pane -->
<div
	style="display:flex; background:#fff; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden; height:calc(100vh - 136px);"
>
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
	<div style="flex:1; overflow:hidden; display:flex; flex-direction:column; min-width:0;">
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
			<div
				style="flex:1; display:flex; align-items:center; justify-content:center; font-size:13px; color:#aaaaaa;"
			>
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
		style="position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; display:flex; align-items:center; justify-content:center;"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Release decisions"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeReleaseModal()}
			style="background:#fff; border-radius:8px; width:480px; max-width:calc(100vw - 48px); box-shadow:0 8px 32px rgba(0,0,0,0.18); overflow:hidden;"
		>
			<!-- Header -->
			<div
				style="padding:20px 24px 16px; border-bottom:1px solid #e0e0e0; display:flex; align-items:flex-start; justify-content:space-between;"
			>
				<div>
					<div style="font-size:16px; font-weight:700; color:#191919;">Release Decisions</div>
					<div style="font-size:13px; color:#aaaaaa; margin-top:4px;">
						This will copy all pending decisions to active decisions and send notification emails.
					</div>
				</div>
				<button
					onclick={closeReleaseModal}
					style="font-size:20px; line-height:1; background:none; border:none; color:#aaaaaa; cursor:pointer; padding:0; margin-top:-2px;"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Body -->
			<div style="padding:20px 24px;">
				<div
					style="background:#fff3f3; border:1px solid #fca5a5; border-radius:5px; padding:12px 14px; margin-bottom:20px;"
				>
					<div style="font-size:13px; font-weight:600; color:#b00000; margin-bottom:4px;">
						{pendingCount} user{pendingCount === 1 ? '' : 's'} will be affected
					</div>
					<div style="font-size:12px; color:#666;">
						Emails will be sent for all accepted, rejected, and waitlisted decisions. This action
						cannot be undone.
					</div>
				</div>

				<div style="margin-bottom:16px;">
					<label
						for="release-confirm"
						style="display:block; font-size:12px; font-weight:600; color:#333; margin-bottom:6px;"
					>
						Type <span
							style="font-family:'DM Mono', monospace; background:#f0f0f0; padding:1px 5px; border-radius:3px;"
							>RELEASE</span
						> to confirm
					</label>
					<input
						id="release-confirm"
						type="text"
						bind:value={releaseConfirmText}
						placeholder="RELEASE"
						style="width:100%; font-size:13px; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:5px; padding:8px 12px; outline:none; box-sizing:border-box; font-family:'DM Mono', monospace;"
					/>
				</div>
			</div>

			<!-- Footer -->
			<div
				style="padding:16px 24px; border-top:1px solid #e0e0e0; display:flex; justify-content:flex-end; gap:10px;"
			>
				<button
					onclick={closeReleaseModal}
					disabled={releasing}
					style="font-size:13px; font-weight:500; color:#191919; background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:8px 16px; cursor:pointer; opacity:{releasing
						? 0.5
						: 1};"
				>
					Cancel
				</button>
				<button
					onclick={handleRelease}
					disabled={releaseConfirmText !== 'RELEASE' || releasing || pendingCount === 0}
					style="font-size:13px; font-weight:600; color:#fff; background:#b00000; border:none; border-radius:6px; padding:8px 18px; cursor:pointer; opacity:{releaseConfirmText ===
						'RELEASE' &&
					!releasing &&
					pendingCount > 0
						? 1
						: 0.4};"
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
		style="position:fixed; bottom:28px; right:28px; z-index:200;"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
