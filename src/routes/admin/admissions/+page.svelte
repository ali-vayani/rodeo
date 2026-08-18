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
	import RankedList from '$lib/components/admissions/RankedList.svelte';
	import ReconsiderList from '$lib/components/admissions/ReconsiderList.svelte';
	import ReviewerStats from '$lib/components/admissions/ReviewerStats.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Modal, Button } from '$lib/components/ui';
	import { Tabs } from '$lib/components/patterns';
	import { createReviewSession, pickNextUnlocked } from '$lib/admissions/reviewSession.svelte';
	import { PRESENCE_POLL_MS } from '$lib/admissions/lock';
	import { MAX_SCORE, type ScoreFilter } from '$lib/admissions/score';
	import type { LinkedField } from '$lib/linkedFields';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Applicant = (typeof data.applicants)[number];

	/**
	 * The two passes, in the order they happen: score the whole queue, then work the
	 * ranking. They are tabs rather than pages because they share the release action
	 * and the counts above them, and because moving between them mid-pass — to check
	 * where a borderline applicant landed — is normal, not a navigation.
	 */
	let tab = $state<'review' | 'decide' | 'stats' | 'reconsider'>('review');

	let applicants = $state<Applicant[]>(untrack(() => [...data.applicants]));
	let selectedUid = $state<string | null>(null);
	let roleTab = $state<Role | 'ALL'>('ALL');
	let search = $state('');
	let scoreFilter = $state<ScoreFilter>('unscored');
	let stats = $state(untrack(() => data.stats));

	// The ranked list is fetched on arrival at the Decide tab, never eagerly: it
	// carries every scored applicant's answers, and scores keep moving while the
	// decision pass is open, so a copy loaded with the page would be stale by the
	// time anyone looked at it.
	let ranked = $state<Applicant[]>([]);
	let rankedLoading = $state(false);
	let deciding = $state(false);
	let releasingOne = $state(false);

	type Reviewer = Awaited<ReturnType<typeof trpc.admissions.reviewerStats.query>>[number];
	let reviewers = $state<Reviewer[]>([]);
	let reviewersLoading = $state(false);

	type DecisionStats = Awaited<ReturnType<typeof trpc.admissions.decisionStats.query>>;
	let decisionStats = $state<DecisionStats | null>(null);

	type Reconsider = Awaited<ReturnType<typeof trpc.admissions.reconsidering.query>>[number];
	let reconsider = $state<Reconsider[]>([]);
	let reconsiderLoading = $state(false);

	/** Chosen values per linked application field, `NO_VALUE` included. */
	let linkedSelected = $state<Partial<Record<LinkedField, string[]>>>({});

	/** What the last list query did with the search term — drives the "did you mean" strip. */
	let searchInfo = $state<typeof data.search>(untrack(() => data.search));

	/**
	 * Whether the current `name` selection came from a suggestion chip rather than the
	 * filter panel.
	 *
	 * A chip sets a filter the organizer can't see without opening the panel, so typing
	 * a fresh search term while one is active would silently intersect the new term with
	 * the old name and return nothing. Panel selections are visible and are left alone.
	 */
	let nameFromSuggestion = $state(false);

	let loading = $state(false);
	let scoreLoading = $state(false);
	let sidebarCollapsed = $state(false);

	// Presence: uid → claimerName, other admins only (the poll filters out our own uid)
	let presenceMap = $state<Record<string, string>>({});
	let paneEl = $state<HTMLElement | null>(null);

	// Release modal
	let showReleaseModal = $state(false);
	let releaseConfirmText = $state('');
	let releasing = $state(false);
	/** UIDs to release, collected when the modal is opened. */
	let releaseUids = $state<string[]>([]);
	/** Which list triggered the release — drives the optimistic update. */
	let releaseScope = $state<'decide' | 'reconsider'>('decide');

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
	// From the server rather than counted off the list: neither tab holds every
	// applicant with a pending decision — the review queue shows the undecided and
	// the ranked list only the scored — so a local count would understate what
	// Release is about to send.
	let pendingCount = $derived(stats.pending);
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

	/**
	 * The linked-field selection in the shape the server expects.
	 *
	 * An untouched — or cleared — field MUST send `undefined`, never `[]`. The predicate
	 * reads an omitted key as "no filter" and an empty array as "match nobody" (the
	 * engaged-but-empty rule `linkedFieldConditions` shares with the send path), so
	 * forwarding the panel's `{ year: [] }` verbatim would empty the queue the moment
	 * someone ticked a box and unticked it again.
	 */
	function linkedFilterArgs(selected: Partial<Record<LinkedField, string[]>>) {
		const pick = (field: LinkedField) => {
			const values = selected[field];
			return values && values.length > 0 ? values : undefined;
		};
		return {
			names: pick('NAME'),
			universities: pick('UNIVERSITY'),
			years: pick('YEAR')
		};
	}

	async function loadApplicants() {
		loading = true;
		try {
			const result = await trpc.admissions.list.query({
				noDecision: true,
				// `all` sends no score filter at all; the other two are a boolean the
				// server reads as "has a score" / "has none".
				scored: scoreFilter === 'all' ? undefined : scoreFilter === 'scored',
				roles: roleTab !== 'ALL' ? [roleTab] : undefined,
				search: search.trim() || undefined,
				...linkedFilterArgs(linkedSelected)
			});
			applicants = result.applicants;
			searchInfo = result.search;
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load applicants'), 'error');
		} finally {
			loading = false;
		}
	}

	async function loadRanked() {
		rankedLoading = true;
		try {
			const result = await trpc.admissions.list.query({ scored: true, sort: 'score' });
			ranked = result.applicants;
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load the ranked list'), 'error');
		} finally {
			rankedLoading = false;
		}
	}

	async function loadReviewerStats() {
		reviewersLoading = true;
		try {
			[reviewers, decisionStats] = await Promise.all([
				trpc.admissions.reviewerStats.query(),
				trpc.admissions.decisionStats.query()
			]);
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load reviewer stats'), 'error');
		} finally {
			reviewersLoading = false;
		}
	}

	async function loadReconsider() {
		reconsiderLoading = true;
		try {
			reconsider = await trpc.admissions.reconsidering.query();
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load reconsider list'), 'error');
		} finally {
			reconsiderLoading = false;
		}
	}

	/** Best-effort: the counts are a readout, and failing to refresh them is not
	    worth an error toast on top of whatever the operator just did. */
	async function refreshStats() {
		try {
			stats = await trpc.admissions.stats.query();
		} catch {
			// keep the last known counts
		}
	}

	function onTabChange(next: string) {
		if (next === 'decide') tab = 'decide';
		else if (next === 'stats') tab = 'stats';
		else if (next === 'reconsider') tab = 'reconsider';
		else tab = 'review';

		if (tab === 'decide') {
			// Refetched on every arrival, not just the first: whatever was scored
			// since the last visit is exactly what the operator came back to see.
			void loadRanked();
			void refreshStats();
		} else if (tab === 'stats') {
			void loadReviewerStats();
			void refreshStats();
		} else if (tab === 'reconsider') {
			void loadReconsider();
			void refreshStats();
		}
	}

	function onRoleTabChange(tab: Role | 'ALL') {
		roleTab = tab;
		loadApplicants();
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(value: string) {
		search = value;
		if (nameFromSuggestion) {
			nameFromSuggestion = false;
			linkedSelected = { ...linkedSelected, NAME: [] };
		}
		clearTimeout(searchTimer);
		searchTimer = setTimeout(loadApplicants, 400);
	}

	// Ticking a checkbox or picking a combobox row is a discrete act, so it refetches
	// immediately — the 400ms debounce exists for keystrokes, which these are not.
	function onLinkedFiltersChange(next: Partial<Record<LinkedField, string[]>>) {
		linkedSelected = next;
		nameFromSuggestion = false;
		loadApplicants();
	}

	function onScoreFilterChange(next: ScoreFilter) {
		scoreFilter = next;
		// The selected applicant is very likely about to leave the list — drop the
		// selection rather than leaving the detail pane showing someone the queue no
		// longer contains, which would strand their claim until it went stale.
		selectedUid = null;
		loadApplicants();
	}

	/**
	 * Narrow to one suggested name — or, clicking the active chip, back out of it.
	 *
	 * Sets the `names` filter rather than rewriting the search box: the typed term is
	 * what produced the suggestions, so replacing it would delete the strip that offered
	 * the alternatives and leave no way to try the next one.
	 */
	function onSuggestionSelect(name: string) {
		const next = linkedSelected.NAME?.includes(name) ? [] : [name];
		linkedSelected = { ...linkedSelected, NAME: next };
		nameFromSuggestion = next.length > 0;
		loadApplicants();
	}

	async function handleSaveScore(score: number, notes: string) {
		if (!selectedUid || !session.canDecide) return;
		const uid = selectedUid;
		const idx = applicants.findIndex((a) => a.uid === uid);

		// Saving is activity — don't let a slow request time out into the idle modal.
		session.noteActivity();
		scoreLoading = true;
		try {
			const saved = await trpc.admissions.setScore.mutate({ uid, score, notes });

			// setScore already cleared the claim server-side — skip the teardown release
			session.markClaimCleared(uid);

			// Navigated away mid-flight; don't clobber the new selection
			if (selectedUid !== uid) return;

			if (scoreFilter === 'unscored') {
				// Scoring is what takes an applicant out of this view, so the row leaves
				// and the queue closes up behind it — same index, next person, skipping
				// anyone another admin holds.
				applicants = applicants.filter((a) => a.uid !== uid);
				rollToNextUnlocked(idx, uid);
			} else {
				// Revisiting a scored applicant: the row stays put and updates in place,
				// because removing it would be the view contradicting its own filter.
				applicants = applicants.map((a) =>
					a.uid === uid
						? {
								...a,
								score: saved.score,
								notes: saved.notes,
								scoredAt: saved.scoredAt,
								scorer: { name: data.adminName }
							}
						: a
				);
				selectNext();
			}
			showToast(`Saved ${score}/${MAX_SCORE}`);
			void refreshStats();
		} catch (e) {
			if (isTRPCErrorCode(e, 'CONFLICT')) {
				// Someone else got there first — the server refused the write.
				session.reclaim();
			}
			showToast(errorMessage(e, 'Failed to save score'), 'error');
		} finally {
			scoreLoading = false;
		}
	}

	/**
	 * Apply a pending decision from the ranked list, one row or a selection.
	 *
	 * A single applicant goes through `setDecision` rather than the bulk path even
	 * though the bulk path would handle it: only `setDecision` can name the admin
	 * whose lock blocked it, and only it writes the blocked-decision audit row. The
	 * bulk mutation can report a count of skipped rows and nothing more, which is
	 * the right answer for two hundred and the wrong one for one.
	 */
	async function handleDecide(uids: string[], decision: DecisionStatus) {
		if (decision === 'PENDING' || uids.length === 0) return;
		deciding = true;
		try {
			let skipped = 0;
			if (uids.length === 1) {
				await trpc.admissions.setDecision.mutate({ uid: uids[0], decision });
				showToast(`Set to ${decision.toLowerCase()}`);
			} else {
				const result = await trpc.admissions.setDecisions.mutate({ uids, decision });
				skipped = result.skipped;
				showToast(
					`Set ${result.updated} to ${decision.toLowerCase()}` +
						(skipped > 0 ? ` — ${skipped} skipped, being reviewed` : '')
				);
			}

			if (skipped > 0) {
				// Which rows were skipped isn't in the response, so the list is refetched
				// rather than guessed at — a decision chip that says ACCEPTED next to
				// someone who wasn't is worse than a second round trip.
				await loadRanked();
			} else {
				const applied = new Set(uids);
				ranked = ranked.map((a) => (applied.has(a.uid) ? { ...a, pendingDecision: decision } : a));
			}
			void refreshStats();
		} catch (e) {
			showToast(errorMessage(e, 'Failed to update decisions'), 'error');
		} finally {
			deciding = false;
		}
	}

	async function handleClear(uid: string) {
		deciding = true;
		try {
			await trpc.admissions.clearDecision.mutate({ uid });
			ranked = ranked.map((a) => (a.uid === uid ? { ...a, pendingDecision: null } : a));
			void refreshStats();
			showToast('Decision cleared');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to clear decision'), 'error');
		} finally {
			deciding = false;
		}
	}

	async function handleReleaseOne(uid: string) {
		releasingOne = true;
		try {
			const applicant = ranked.find((a) => a.uid === uid);
			await trpc.admissions.release.mutate({ uids: [uid] });
			ranked = ranked.map((a) =>
				a.uid === uid
					? { ...a, activeDecision: a.pendingDecision ?? a.activeDecision, pendingDecision: null }
					: a
			);
			void refreshStats();
			showToast(`Released decision for ${applicant?.name ?? 'applicant'}`);
		} catch (e) {
			showToast(errorMessage(e, 'Failed to release decision'), 'error');
		} finally {
			releasingOne = false;
		}
	}

	/** Same shape as handleDecide but operates on the reconsider list. */
	async function handleReconsiderDecide(uids: string[], decision: DecisionStatus) {
		if (decision === 'PENDING' || uids.length === 0) return;
		deciding = true;
		try {
			await trpc.admissions.setDecision.mutate({ uid: uids[0], decision });
			reconsider = reconsider.map((a) =>
				a.uid === uids[0] ? { ...a, pendingDecision: decision } : a
			);
			void refreshStats();
			showToast(`Set to ${decision.toLowerCase()}`);
		} catch (e) {
			showToast(errorMessage(e, 'Failed to update decision'), 'error');
		} finally {
			deciding = false;
		}
	}

	async function handleReconsiderClear(uid: string) {
		deciding = true;
		try {
			await trpc.admissions.clearDecision.mutate({ uid });
			reconsider = reconsider.map((a) => (a.uid === uid ? { ...a, pendingDecision: null } : a));
			void refreshStats();
			showToast('Decision cleared');
		} catch (e) {
			showToast(errorMessage(e, 'Failed to clear decision'), 'error');
		} finally {
			deciding = false;
		}
	}

	async function handleReconsiderReleaseOne(uid: string) {
		releasingOne = true;
		try {
			const applicant = reconsider.find((a) => a.uid === uid);
			await trpc.admissions.release.mutate({ uids: [uid] });
			// After release the new decision becomes active — update both fields.
			reconsider = reconsider.map((a) =>
				a.uid === uid
					? { ...a, activeDecision: a.pendingDecision ?? a.activeDecision, pendingDecision: null }
					: a
			);
			void refreshStats();
			showToast(`Released decision for ${applicant?.name ?? 'applicant'}`);
		} catch (e) {
			showToast(errorMessage(e, 'Failed to release decision'), 'error');
		} finally {
			releasingOne = false;
		}
	}

	function hasPendingDecision(a: { pendingDecision: string | null }) {
		return a.pendingDecision !== null && a.pendingDecision !== 'PENDING';
	}

	let decidePending = $derived(ranked.filter(hasPendingDecision).length);
	let reconsiderPending = $derived(reconsider.filter(hasPendingDecision).length);

	async function handleRelease() {
		releasing = true;
		try {
			const result = await trpc.admissions.release.mutate({ uids: releaseUids });
			const released = new Set(releaseUids);
			const apply = <
				T extends { uid: string; pendingDecision: string | null; activeDecision: string | null }
			>(
				list: T[]
			): T[] =>
				list.map((a) =>
					released.has(a.uid)
						? { ...a, activeDecision: a.pendingDecision ?? a.activeDecision, pendingDecision: null }
						: a
				);
			if (releaseScope === 'decide') ranked = apply(ranked);
			else reconsider = apply(reconsider);
			void refreshStats();
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

	function openReleaseModal(scope: 'decide' | 'reconsider') {
		const list = scope === 'decide' ? ranked : reconsider;
		releaseUids = list.filter(hasPendingDecision).map((a) => a.uid);
		releaseScope = scope;
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
<div class="mb-4">
	<h1 class="text-[22px] font-bold text-primary">Admissions</h1>
	<span class="mt-0.5 block text-[13px] text-muted-foreground">
		{stats.unscored} left to score · {stats.accepted} accepted · {stats.rejected} rejected ·
		{stats.waitlisted} waitlisted · {pendingCount} pending release
	</span>
</div>

<!--
	The tabs are a fixed-size row of a column that is itself exactly one workspace
	tall, and the pane below takes whatever is left. Stacking them above a
	`workspace-h` pane instead would push the pane's own bottom edge — and with it
	the score field, the thing the reviewer is here to use — off the screen.

	The counts that used to sit here as four tiles now live on one line under the
	page title: they were costing 118px of the reviewing surface to say what fits
	in a sentence, and being pinned above a scrolling pane made them read as
	chrome that would not go away.
-->
<div class="flex flex-col md:workspace-h md:overflow-hidden">
	<Tabs
		tabs={[
			{ value: 'review', label: 'Review', badge: stats.unscored },
			{ value: 'decide', label: 'Pending Decisions', badge: stats.scored },
			{ value: 'reconsider', label: 'Reconsider' },
			{ value: 'stats', label: 'Stats' }
		]}
		active={tab}
		onChange={onTabChange}
		class="mb-4 shrink-0"
	/>

	{#if tab === 'review'}
		<!-- Split pane from md up; stacked list ⇄ detail navigation below md -->
		<div
			class="flex rounded-md border border-border bg-white md:min-h-0 md:flex-1 md:overflow-hidden"
		>
			<ApplicantList
				{applicants}
				{selectedUid}
				onSelect={(uid) => (selectedUid = uid)}
				{roleTab}
				{onRoleTabChange}
				{search}
				{onSearchInput}
				{scoreFilter}
				{onScoreFilterChange}
				facets={data.facets}
				{linkedSelected}
				{onLinkedFiltersChange}
				{searchInfo}
				{onSuggestionSelect}
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
						onSaveScore={handleSaveScore}
						{scoreLoading}
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
							? scoreFilter === 'unscored'
								? 'Every application here has been scored — head to Decide'
								: 'No applicants in this view'
							: Object.keys(presenceMap).length >= applicants.length
								? 'Everyone in this view is being reviewed. Try another role tab or clear your search.'
								: 'Select an applicant to score their application'}
					</div>
				{/if}
			</div>
		</div>
	{:else if tab === 'decide'}
		<!-- The ranked list scrolls inside the same remaining height, so the bulk
		     toolbar stays put while the table moves under it. -->
		<div class="md:min-h-0 md:flex-1 md:overflow-y-auto">
			<div class="mb-3 flex items-center justify-between">
				<span class="text-xs text-foreground-secondary">
					{decidePending} pending decision{decidePending === 1 ? '' : 's'}
				</span>
				<button
					onclick={() => openReleaseModal('decide')}
					disabled={decidePending === 0}
					class="cursor-pointer rounded-md border-none bg-destructive px-[14px] py-[7px] text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
				>
					Release Decisions
				</button>
			</div>
			<RankedList
				applicants={ranked.filter((a) => !a.activeDecision)}
				loading={rankedLoading}
				{deciding}
				{releasingOne}
				unscoredCount={stats.unscored}
				onDecide={handleDecide}
				onClear={handleClear}
				onReleaseOne={handleReleaseOne}
			/>
		</div>
	{:else if tab === 'reconsider'}
		<div class="md:min-h-0 md:flex-1 md:overflow-y-auto">
			<div class="mb-3 flex items-center justify-between">
				<span class="text-xs text-foreground-secondary">
					{reconsiderPending} pending decision{reconsiderPending === 1 ? '' : 's'}
				</span>
				<button
					onclick={() => openReleaseModal('reconsider')}
					disabled={reconsiderPending === 0}
					class="cursor-pointer rounded-md border-none bg-destructive px-[14px] py-[7px] text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
				>
					Release Decisions
				</button>
			</div>
			<ReconsiderList
				applicants={reconsider}
				loading={reconsiderLoading}
				{deciding}
				{releasingOne}
				onDecide={handleReconsiderDecide}
				onClear={handleReconsiderClear}
				onReleaseOne={handleReconsiderReleaseOne}
			/>
		</div>
	{:else}
		<div class="md:min-h-0 md:flex-1 md:overflow-y-auto">
			<ReviewerStats {reviewers} loading={reviewersLoading} {stats} {decisionStats} />
		</div>
	{/if}
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
	description="This will email the pending decisions and mark them as active."
	dismissible={!releasing}
	onClose={() => (releaseConfirmText = '')}
>
	<div class="mb-5 rounded-md border border-danger-200 bg-danger-50 px-3.5 py-3">
		<div class="mb-1 text-base font-semibold text-danger-700">
			{releaseUids.length} user{releaseUids.length === 1 ? '' : 's'} will be affected
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
			disabled={releaseConfirmText !== 'RELEASE' || releaseUids.length === 0}
			onclick={handleRelease}
		>
			Release {releaseUids.length} Decision{releaseUids.length === 1 ? '' : 's'}
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
