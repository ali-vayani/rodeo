<script lang="ts">
	import type { Role, DecisionStatus } from '$lib/generated/prisma/enums';
	import { errorMessage, isTRPCErrorCode } from '$lib/ui/errors';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import ApplicantList from '$lib/components/admissions/ApplicantList.svelte';
	import ApplicantDetail from '$lib/components/admissions/ApplicantDetail.svelte';
	import IdleWarningModal from '$lib/components/admissions/IdleWarningModal.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Modal, Button } from '$lib/components/ui';
	import { createReviewSession, pickNextUnlocked } from '$lib/admissions/reviewSession.svelte';
	import { PRESENCE_POLL_MS } from '$lib/admissions/lock';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Applicant = (typeof data.applicants)[number];

	let applicants = $state<Applicant[]>(untrack(() => [...data.applicants]));
	let selectedUid = $state<string | null>(null);
	let roleTab = $state<Role | 'ALL'>('ALL');
	let search = $state('');
	let loading = $state(false);
	let decisionLoading = $state(false);
	let sidebarCollapsed = $state(false);

	// Presence: uid → claimerName, other admins only (the poll filters out our own uid)
	let presenceMap = $state<Record<string, string>>({});
	let paneEl = $state<HTMLElement | null>(null);

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

	// Review lock: claim on select, heartbeat while active, idle warning, release.
	const session = createReviewSession({
		getUid: () => selectedUid,
		getPresence: () => presenceMap,
		onToast: showToast,
		onRerollNeeded: (uid, takenBy) => {
			const takenName = applicants.find((a) => a.uid === uid)?.name ?? 'That applicant';
			// Optimistically mark it held so the next pick can't land on it again.
			presenceMap = { ...presenceMap, [uid]: takenBy ?? 'Another admin' };
			rollToNextUnlocked(
				applicants.findIndex((a) => a.uid === uid),
				uid,
				takenName,
				takenBy
			);
		}
	});

	// Activity listeners live on the review pane, and must be capture-phase so that
	// scrolling inside the detail pane's own scroll container counts.
	$effect(() => (paneEl ? session.observePane(paneEl) : undefined));

	function rollToNextUnlocked(
		fromIndex: number,
		excludeUid: string | null,
		takenName?: string,
		takenBy?: string | null
	) {
		const uid = pickNextUnlocked(applicants, presenceMap, fromIndex, excludeUid);
		if (!uid) {
			selectedUid = null;
			showToast(
				applicants.length === 0
					? 'All applicants in this view have been reviewed'
					: 'Everyone left in this view is being reviewed by another admin',
				'error'
			);
			return;
		}
		if (takenName) {
			const nextName = applicants.find((a) => a.uid === uid)?.name ?? 'the next applicant';
			showToast(
				`${takenName} was taken by ${takenBy ?? 'another admin'} — moved you to ${nextName}`,
				'error'
			);
		}
		selectedUid = uid;
	}

	// Presence poll: refresh who-is-reviewing-what
	$effect(() => {
		const adminUid = data.adminUid;

		async function fetchPresence() {
			// A dozen background tabs polling every 20s is meaningful pointless load.
			if (document.hidden) return;
			try {
				const rows = await trpc.admissions.presence.query();
				const map: Record<string, string> = {};
				for (const r of rows) {
					if (r.claimedBy !== adminUid) map[r.uid] = r.claimerName;
				}
				presenceMap = map;
			} catch {
				// best-effort
			}
		}

		function onVisible() {
			if (!document.hidden) void fetchPresence();
		}

		void fetchPresence();
		const id = setInterval(fetchPresence, PRESENCE_POLL_MS);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	async function loadApplicants() {
		loading = true;
		try {
			applicants = await trpc.admissions.list.query({
				noDecision: true,
				roles: roleTab !== 'ALL' ? [roleTab] : undefined,
				search: search.trim() || undefined
			});
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load applicants'), 'error');
		} finally {
			loading = false;
		}
	}

	function onRoleTabChange(tab: Role | 'ALL') {
		roleTab = tab;
		loadApplicants();
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(value: string) {
		search = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(loadApplicants, 400);
	}

	async function handleDecision(decision: DecisionStatus) {
		// PENDING is a starting state, not a decision to publish — the bar never sends it,
		// and setDecision no longer accepts it. Guard narrows the type for the mutate call.
		if (decision === 'PENDING') return;
		if (!selectedUid || !session.canDecide) return;
		const uid = selectedUid;
		const idx = applicants.findIndex((a) => a.uid === uid);

		// Deciding is activity — don't let a slow request time out into the idle modal.
		session.noteActivity();
		decisionLoading = true;
		try {
			await trpc.admissions.setDecision.mutate({ uid, decision });

			// setDecision already cleared the claim server-side — skip the teardown release
			session.markDecided(uid);

			// Navigated away mid-flight; don't clobber the new selection
			if (selectedUid !== uid) return;

			// Remove from list — they now have a pending decision
			applicants = applicants.filter((a) => a.uid !== uid);
			// Same index in the new array = the next person, skipping anyone locked
			rollToNextUnlocked(idx, uid);
		} catch (e) {
			if (isTRPCErrorCode(e, 'CONFLICT')) {
				// Someone else got there first — the server refused the write.
				session.reclaim();
			}
			showToast(errorMessage(e, 'Failed to update decision'), 'error');
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
			showToast(
				`Released decisions for ${result.released} user${result.released === 1 ? '' : 's'}`
			);
		} catch (e) {
			showToast(errorMessage(e, 'Release failed'), 'error');
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
<div class="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
	<div>
		<h1 class="text-[22px] font-bold text-primary">Admissions</h1>
		<span class="mt-0.5 block text-[13px] text-muted-foreground">
			{applicants.length} remaining · {pendingCount} pending review
		</span>
	</div>
	<button
		onclick={openReleaseModal}
		class="cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-white"
	>
		Release Decisions
	</button>
</div>

<!-- Split pane from md up; stacked list ⇄ detail navigation below md -->
<div class="flex workspace-h rounded-md border border-border bg-white md:overflow-hidden">
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
		{presenceMap}
		selfClaimUid={session.phase === 'owned' || session.phase === 'warning' ? selectedUid : null}
	/>

	<!-- Right detail pane. Below md it replaces the list when an applicant is
	     selected, and disappears entirely (no room for an empty-state pane)
	     when none is. -->
	<div
		bind:this={paneEl}
		class="min-w-0 flex-1 flex-col md:flex md:overflow-hidden {selected ? 'flex' : 'hidden'}"
	>
		{#if selected}
			<ApplicantDetail
				applicant={selected}
				onDecision={handleDecision}
				{decisionLoading}
				{hasPrev}
				{hasNext}
				onPrev={selectPrev}
				onNext={selectNext}
				onBack={() => (selectedUid = null)}
				lockState={session.phase}
				claimerName={session.claimerName}
				lockFreed={session.lockFreed}
				onReclaim={session.reclaim}
			/>
		{:else}
			<div class="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
				{applicants.length === 0
					? 'All applicants have been reviewed'
					: Object.keys(presenceMap).length >= applicants.length
						? 'Everyone in this view is being reviewed. Try another role tab or clear your search.'
						: 'Select an applicant to review their application'}
			</div>
		{/if}
	</div>
</div>

<!-- Idle warning: lock is still held while this counts down -->
{#if session.showIdleModal && selected}
	<IdleWarningModal
		applicantName={selected.name}
		remainingLabel={session.graceRemainingLabel}
		remainingMs={session.graceRemainingMs}
		onConfirm={session.confirm}
		onRelease={session.releaseNow}
	/>
{/if}

<!-- Release Decisions modal -->
<Modal
	bind:open={showReleaseModal}
	title="Release Decisions"
	description="This will copy all pending decisions to active decisions and send notification emails."
	dismissible={!releasing}
	onClose={() => (releaseConfirmText = '')}
>
	<div class="mb-5 rounded-md border border-danger-200 bg-danger-50 px-3.5 py-3">
		<div class="mb-1 text-base font-semibold text-danger-700">
			{pendingCount} user{pendingCount === 1 ? '' : 's'} will be affected
		</div>
		<div class="text-xs text-foreground-secondary">
			Emails will be sent for all accepted, rejected, and waitlisted decisions. This action cannot
			be undone.
		</div>
	</div>

	<div>
		<label for="release-confirm" class="mb-1.5 block text-xs font-semibold text-foreground">
			Type <span class="rounded-sm bg-neutral-100 px-1 font-mono">RELEASE</span> to confirm
		</label>
		<input
			id="release-confirm"
			type="text"
			bind:value={releaseConfirmText}
			placeholder="RELEASE"
			class="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-touch text-foreground outline-none focus-visible:shadow-ring sm:text-base"
		/>
	</div>

	{#snippet footer()}
		<Button onclick={closeReleaseModal} disabled={releasing}>Cancel</Button>
		<Button
			variant="danger"
			loading={releasing}
			disabled={releaseConfirmText !== 'RELEASE' || pendingCount === 0}
			onclick={handleRelease}
		>
			Release {pendingCount} Decision{pendingCount === 1 ? '' : 's'}
		</Button>
	{/snippet}
</Modal>

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
