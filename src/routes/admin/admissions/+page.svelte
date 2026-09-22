<script lang="ts">
	import type { Role, DecisionStatus } from '$lib/generated/prisma/enums';
	import { errorMessage, isTRPCErrorCode } from '$lib/ui/errors';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import ApplicantList from '$lib/components/admissions/ApplicantList.svelte';
	import ApplicantDetail from '$lib/components/admissions/ApplicantDetail.svelte';
	import IdleWarningModal from '$lib/components/admissions/IdleWarningModal.svelte';
	import RankedList from '$lib/components/admissions/RankedList.svelte';
	import RubricEditorModal from '$lib/components/admissions/RubricEditorModal.svelte';
	import ReconsiderList from '$lib/components/admissions/ReconsiderList.svelte';
	import ReviewerStats from '$lib/components/admissions/ReviewerStats.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Modal, Button } from '$lib/components/ui';
	import { Tabs } from '$lib/components/patterns';
	import { createReviewSession, pickNextUnlocked } from '$lib/admissions/reviewSession.svelte';
	import { PRESENCE_POLL_MS } from '$lib/admissions/lock';
	import { MAX_SCORE, type ScoreFilter } from '$lib/admissions/score';
	import { rubricForRole, rubricMaxScore, type CriterionDraft } from '$lib/admissions/rubric';
	import { APPLICANT_ROLES } from '$lib/admissions/roles';
	import { facetParams } from '$lib/admin/filters';
	import { isEngaged, linkedFacetKey, type FacetState } from '$lib/facets';
	import FacetFilters from '$lib/components/admin/FacetFilters.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type ListResult = Awaited<ReturnType<typeof trpc.admissions.list.query>>;
	type Applicant = ListResult['applicants'][number];
	type StatsResult = Awaited<ReturnType<typeof trpc.admissions.stats.query>>;
	type FacetsResult = Awaited<ReturnType<typeof trpc.filters.facets.query>>;

	/**
	 * The two passes, in the order they happen: score the whole queue, then work the
	 * ranking. Tabs rather than pages because they share the release action and the counts
	 * above them, and moving between them mid-pass is normal.
	 */
	let tab = $state<'review' | 'decide' | 'stats' | 'reconsider'>('review');

	const DEFAULT_STATS: StatsResult = {
		accepted: 0,
		rejected: 0,
		waitlisted: 0,
		undecided: 0,
		pending: 0,
		scored: 0,
		unscored: 0
	};

	let pageLoading = $state(true);
	let applicants = $state<Applicant[]>([]);
	let selectedUid = $state<string | null>(null);
	let roleTab = $state<Role | 'ALL'>('ALL');
	let search = $state('');
	let scoreFilter = $state<ScoreFilter>('unscored');
	let stats = $state<StatsResult>(DEFAULT_STATS);

	/** Review queue pagination — this is the list that can run into the thousands. */
	const APPLICANTS_PAGE_SIZE = 100;
	let applicantsPage = $state(1);
	let applicantsTotal = $state(0);
	let applicantsTotalPages = $derived(
		Math.max(1, Math.ceil(applicantsTotal / APPLICANTS_PAGE_SIZE))
	);

	let rubric = $state<Awaited<ReturnType<typeof trpc.rubric.get.query>>>([]);
	let showRubricEditor = $state(false);
	let rubricSaving = $state(false);

	/** A role with a rubric scores out of its best total; one without, out of the flat 0–20. */
	let maxScoreFor = $derived((role: string) => {
		const roleRubric = rubricForRole(rubric, role);
		return roleRubric.length > 0 ? rubricMaxScore(roleRubric) : MAX_SCORE;
	});

	/** Curried version for passing to child components that don't hold the rubric state. */
	let rubricForRoleLocal = $derived((role: string) => rubricForRole(rubric, role));

	/** For the Stats tab, where one average spans every role's scale. */
	let scaleHint = $derived.by(() => {
		const maxes = new Set(APPLICANT_ROLES.map((role) => maxScoreFor(role)));
		return maxes.size === 1 ? `out of ${[...maxes][0]}` : 'scales vary by role';
	});

	// Fetched on arrival at the Decide tab, never eagerly. It carries every scored
	// applicant's answers, and scores keep moving while the decision pass is open.
	let ranked = $state<Applicant[]>([]);
	let rankedLoading = $state(false);
	/** Unfiltered total for the tab badge — updated only when no facet filters are active. */
	let rankedUnfilteredTotal = $state<number | null>(null);
	let deciding = $state(false);
	let releasingOne = $state(false);
	/** UIDs currently checked in the Pending Decisions ranked list. */
	let rankedSelected = $state<string[]>([]);

	type Reviewer = Awaited<ReturnType<typeof trpc.admissions.reviewerStats.query>>[number];
	let reviewers = $state<Reviewer[]>([]);
	let reviewersLoading = $state(false);

	type DecisionStats = Awaited<ReturnType<typeof trpc.admissions.decisionStats.query>>;
	let decisionStats = $state<DecisionStats | null>(null);

	type Reconsider = Awaited<ReturnType<typeof trpc.admissions.reconsidering.query>>[number];
	let reconsider = $state<Reconsider[]>([]);
	let reconsiderLoading = $state(false);

	/** What each application-answer facet's controls hold, keyed by `Facet.key`. */
	let facetSelection = $state<FacetState>({});

	let reviewFacets = $state<FacetsResult>([]);

	/** Facet filters for the Pending Decisions tab — separate state so the two tabs don't share. */
	let decideFacets = $state<FacetsResult>([]);
	let decideFacetSelection = $state<FacetState>({});
	let decideFiltersOpen = $state(false);
	let decideActiveFilterCount = $derived(
		Object.values(decideFacetSelection).filter((s) => isEngaged(s)).length
	);

	/** The Name facet, which the did-you-mean chips drive directly. See `onSuggestionSelect`. */
	const NAME_FACET = linkedFacetKey('NAME');

	/** What the last list query did with the search term — drives the "did you mean" strip. */
	let searchInfo = $state<ListResult['search']>({
		names: [],
		fuzzy: false,
		capped: false,
		exact: 0
	});

	/**
	 * Whether the current `name` selection came from a suggestion chip rather than the
	 * filter panel.
	 *
	 * A chip sets a filter the organizer cannot see without opening the panel, so typing a
	 * fresh search term while one is active would silently intersect the two and return
	 * nothing. Panel selections are visible and are left alone.
	 */
	let nameFromSuggestion = $state(false);

	let loading = $state(false);
	let scoreLoading = $state(false);
	let sidebarCollapsed = $state(false);

	// Presence: uid → claimerName, other admins only (the poll filters out our own uid)
	let presenceMap = $state<Record<string, string>>({});
	let paneEl = $state<HTMLElement | null>(null);

	let showReleaseModal = $state(false);
	let releaseConfirmText = $state('');
	let releasing = $state(false);
	/** UIDs to release, collected when the modal is opened. */
	let releaseUids = $state<string[]>([]);
	/** Which list triggered the release — drives the optimistic update. */
	let releaseScope = $state<'decide' | 'reconsider'>('decide');

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let selectedIndex = $derived(applicants.findIndex((a) => a.uid === selectedUid));
	let selected = $derived(selectedIndex >= 0 ? applicants[selectedIndex] : null);
	// From the server rather than counted off the list. Neither tab holds every applicant
	// with a pending decision, so a local count would understate what Release will send.
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
			void rollToNextUnlocked(
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

	async function rollToNextUnlocked(
		fromIndex: number,
		excludeUid: string | null,
		takenName?: string,
		takenBy?: string | null
	) {
		let uid = pickNextUnlocked(applicants, presenceMap, fromIndex, excludeUid);

		// `applicants` is only the current page, not the whole queue — exhausting it
		// locally (everyone decided, or everyone left is locked) doesn't mean the queue
		// is actually empty. Refetch before reporting "done" so a fuller page 2 doesn't
		// get reported as "no more applicants".
		if (!uid) {
			await loadApplicants();
			uid = pickNextUnlocked(applicants, presenceMap, 0, excludeUid);
		}

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

	$effect(() => {
		async function initialLoad() {
			try {
				const [listResult, fetchedFacets, fetchedStats, fetchedRubric] = await Promise.all([
					trpc.admissions.list.query({
						noDecision: true,
						scored: false,
						page: applicantsPage,
						pageSize: APPLICANTS_PAGE_SIZE
					}),
					trpc.filters.facets.query(),
					trpc.admissions.stats.query(),
					trpc.rubric.get.query()
				]);
				applicants = listResult.applicants;
				searchInfo = listResult.search;
				applicantsTotal = listResult.total;
				reviewFacets = fetchedFacets;
				decideFacets = fetchedFacets;
				stats = fetchedStats;
				rubric = fetchedRubric;
			} catch (e) {
				showToast(errorMessage(e, 'Failed to load admissions data'), 'error');
			} finally {
				pageLoading = false;
			}
		}
		void initialLoad();
	});

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
			const result = await trpc.admissions.list.query({
				noDecision: true,
				// `all` sends no score filter at all; the other two are a boolean the
				// server reads as "has a score" / "has none".
				scored: scoreFilter === 'all' ? undefined : scoreFilter === 'scored',
				roles: roleTab !== 'ALL' ? [roleTab] : undefined,
				search: search.trim() || undefined,
				page: applicantsPage,
				pageSize: APPLICANTS_PAGE_SIZE,
				// `facetParams` omits an untouched or cleared facet's key rather than sending `[]`.
				// The predicate reads an omitted key as "no filter" and an empty array as "match
				// nobody", so forwarding `{ values: [] }` verbatim would empty the queue the moment
				// someone ticked a box and unticked it again.
				...facetParams(facetSelection)
			});
			applicants = result.applicants;
			searchInfo = result.search;
			applicantsTotal = result.total;
		} catch (e) {
			showToast(errorMessage(e, 'Failed to load applicants'), 'error');
		} finally {
			loading = false;
		}
	}

	/** Any filter/search/role change invalidates the current page — it may not exist in the new result set. */
	function loadApplicantsFromStart() {
		applicantsPage = 1;
		loadApplicants();
	}

	function goToApplicantsPage(next: number) {
		if (next < 1 || next > applicantsTotalPages || next === applicantsPage) return;
		applicantsPage = next;
		selectedUid = null;
		loadApplicants();
	}

	async function loadDecideFacets() {
		try {
			decideFacets = await trpc.filters.facets.query({ scoredOrPending: true });
		} catch {
			// keep the last known facets
		}
	}

	async function loadRanked() {
		rankedLoading = true;
		try {
			const result = await trpc.admissions.list.query({
				scoredOrPending: true,
				sort: 'score',
				...facetParams(decideFacetSelection)
			});
			ranked = result.applicants;
			// Only update the unfiltered total when no facet filters are active,
			// so the tab badge doesn't change when the operator narrows the list.
			if (decideActiveFilterCount === 0) {
				rankedUnfilteredTotal = result.applicants.filter((a) => !a.activeDecision).length;
			}
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

	// Best-effort: the counts are a readout, and failing to refresh them is not worth an
	// error toast on top of whatever the operator just did.
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
			void loadDecideFacets();
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
		loadApplicantsFromStart();
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(value: string) {
		search = value;
		if (nameFromSuggestion) {
			nameFromSuggestion = false;
			facetSelection = { ...facetSelection, [NAME_FACET]: { values: [] } };
		}
		applicantsPage = 1;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(loadApplicants, 400);
	}

	// Ticking a checkbox or picking a combobox row is a discrete act, so it refetches
	// immediately — the 400ms debounce exists for keystrokes, which these are not.
	function onFacetsChange(next: FacetState) {
		facetSelection = next;
		nameFromSuggestion = false;
		loadApplicantsFromStart();
	}

	function onScoreFilterChange(next: ScoreFilter) {
		scoreFilter = next;
		// The selected applicant is very likely about to leave the list, and leaving the
		// detail pane on them would strand their claim until it went stale.
		selectedUid = null;
		loadApplicantsFromStart();
	}

	/**
	 * Narrow to one suggested name, or click the active chip to back out of it.
	 *
	 * Sets the `names` filter rather than rewriting the search box. The typed term is what
	 * produced the suggestions, so replacing it would delete the strip that offered them.
	 */
	function onSuggestionSelect(name: string) {
		const next = facetSelection[NAME_FACET]?.values?.includes(name) ? [] : [name];
		facetSelection = { ...facetSelection, [NAME_FACET]: { values: next } };
		nameFromSuggestion = next.length > 0;
		loadApplicantsFromStart();
	}

	async function handleSaveScore(score: number, notes: string) {
		if (!selectedUid || !session.canDecide) return;
		const uid = selectedUid;
		// Saving is activity — don't let a slow request time out into the idle modal.
		session.noteActivity();
		scoreLoading = true;
		try {
			const saved = await trpc.admissions.setScore.mutate({ uid, score, notes });

			// setScore already cleared the claim server-side — skip the teardown release
			session.markClaimCleared(uid);

			// Navigated away mid-flight; don't clobber the new selection
			if (selectedUid !== uid) return;

			// The row updates in place and stays selected — in the "To score" view it now
			// mismatches the filter until the next refetch, but yanking the reviewer to the
			// next applicant was worse. Moving on is the Next button's job.
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
			// Saving released the claim; take it straight back so the applicant stays held.
			session.reclaim();
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

	/** Rubric counterpart of `handleSaveScore`; the server computes the total itself. */
	async function handleSaveRubricScore(
		selections: Array<{ criterionId: string; levelId: string }>,
		delta: number,
		notes: string
	) {
		if (!selectedUid || !session.canDecide) return;
		const uid = selectedUid;

		session.noteActivity();
		scoreLoading = true;
		try {
			const saved = await trpc.admissions.setRubricScore.mutate({ uid, selections, delta, notes });
			session.markClaimCleared(uid);
			if (selectedUid !== uid) return;

			// Stays put and stays selected, like handleSaveScore.
			applicants = applicants.map((a) =>
				a.uid === uid
					? {
							...a,
							score: saved.score,
							scoreDelta: saved.scoreDelta,
							rubricSelections: selections,
							notes: saved.notes,
							scoredAt: saved.scoredAt,
							scorer: { name: data.adminName }
						}
					: a
			);
			session.reclaim();
			showToast(`Saved ${saved.score}/${maxScoreFor(saved.role)}`);
			void refreshStats();
		} catch (e) {
			if (isTRPCErrorCode(e, 'CONFLICT')) {
				session.reclaim();
			}
			showToast(errorMessage(e, 'Failed to save score'), 'error');
		} finally {
			scoreLoading = false;
		}
	}

	/** Rescores an applicant directly from the Pending Decisions ranked list. */
	async function handleRankedRubricScore(
		uid: string,
		selections: Array<{ criterionId: string; levelId: string }>,
		delta: number
	) {
		rankedLoading = true;
		try {
			const saved = await trpc.admissions.setRubricScore.mutate({ uid, selections, delta });
			ranked = ranked.map((a) =>
				a.uid === uid
					? {
							...a,
							score: saved.score,
							scoreDelta: saved.scoreDelta,
							rubricSelections: selections,
							scorer: { name: data.adminName }
						}
					: a
			);
			showToast(`Saved ${saved.score}/${maxScoreFor(saved.role)}`);
			void refreshStats();
		} catch (e) {
			showToast(errorMessage(e, 'Failed to save score'), 'error');
			throw e;
		} finally {
			rankedLoading = false;
		}
	}

	async function handleSaveRubric(rubrics: Array<{ role: Role; criteria: CriterionDraft[] }>) {
		rubricSaving = true;
		try {
			rubric = await trpc.rubric.save.mutate({
				// The editor's validity gate guarantees points are filled; the map is for the types.
				rubrics: rubrics.map((r) => ({
					role: r.role,
					criteria: r.criteria.map((c) => ({
						...c,
						levels: c.levels.map((l) => ({ ...l, points: l.points ?? 0 }))
					}))
				}))
			});
			showRubricEditor = false;
			showToast('Rubrics saved');
			// A removed criterion or level cascades its selections away; refetch so reopened
			// applicants show what actually survived.
			void loadApplicants();
		} catch (e) {
			showToast(errorMessage(e, 'Failed to save rubric'), 'error');
		} finally {
			rubricSaving = false;
		}
	}

	let reviewDeciding = $state(false);

	/**
	 * Sets a pending decision straight from the review pane. The queue only holds
	 * undecided applicants, so the row always leaves and the pane rolls to the next,
	 * mirroring what saving a score does. `setDecision` clears the claim server-side.
	 */
	async function handleReviewDecide(decision: 'ACCEPTED' | 'REJECTED' | 'WAITLISTED') {
		if (!selectedUid || !session.canDecide) return;
		const uid = selectedUid;
		const idx = applicants.findIndex((a) => a.uid === uid);

		session.noteActivity();
		reviewDeciding = true;
		try {
			await trpc.admissions.setDecision.mutate({ uid, decision });
			session.markClaimCleared(uid);
			if (selectedUid !== uid) return;

			applicants = applicants.filter((a) => a.uid !== uid);
			await rollToNextUnlocked(idx, uid);
			showToast(`Set to ${decision.toLowerCase()}`);
			void refreshStats();
		} catch (e) {
			if (isTRPCErrorCode(e, 'CONFLICT')) {
				session.reclaim();
			}
			showToast(errorMessage(e, 'Failed to set decision'), 'error');
		} finally {
			reviewDeciding = false;
		}
	}

	/**
	 * Reopens a decided applicant in the review pane for a fresh score. The review
	 * queue excludes anyone with a decision, so the row is carried over from the list
	 * it came from rather than refetched; selecting it engages the claim lock through
	 * the normal path, and saving overwrites score and attribution as usual.
	 */
	async function handleRescore(uid: string) {
		const applicant = ranked.find((a) => a.uid === uid) ?? reconsider.find((a) => a.uid === uid);
		if (!applicant) return;
		tab = 'review';
		scoreFilter = 'scored';
		applicantsPage = 1;
		// Shown immediately; the refetch below replaces the list around it.
		applicants = [applicant];
		selectedUid = uid;
		await loadApplicants();
		if (!applicants.some((a) => a.uid === uid)) {
			applicants = [applicant, ...applicants];
		}
	}

	/**
	 * Apply a pending decision from the ranked list, one row or a selection.
	 *
	 * A single applicant goes through `setDecision` rather than the bulk path, because only
	 * `setDecision` can name the admin whose lock blocked it and write the blocked-decision
	 * audit row. A count of skipped rows is the right answer for two hundred, not for one.
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
				// Which rows were skipped isn't in the response, so the list is refetched rather
				// than guessed at.
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
	let selectedWithPending = $derived(
		rankedSelected.filter((uid) => ranked.some((a) => a.uid === uid && hasPendingDecision(a)))
	);
	let decideTotal = $derived(ranked.filter((a) => !a.activeDecision).length);
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

	function openReleaseModal(scope: 'decide' | 'reconsider' | 'selected') {
		if (scope === 'selected') {
			const selectedSet = new Set(rankedSelected);
			releaseUids = ranked
				.filter((a) => selectedSet.has(a.uid) && hasPendingDecision(a))
				.map((a) => a.uid);
			releaseScope = 'decide';
		} else {
			const list = scope === 'decide' ? ranked : reconsider;
			releaseUids = list.filter(hasPendingDecision).map((a) => a.uid);
			releaseScope = scope;
		}
		releaseConfirmText = '';
		showReleaseModal = true;
	}

	function closeReleaseModal() {
		if (releasing) return;
		showReleaseModal = false;
		releaseConfirmText = '';
	}
</script>

{#if pageLoading}
	<div class="flex h-full items-center justify-center py-32">
		<div class="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary"></div>
	</div>
{:else}
	<div class="mb-4 flex items-start justify-between gap-3">
		<div>
			<h1 class="text-[22px] font-bold text-primary">Admissions</h1>
			<span class="mt-0.5 block text-[13px] text-muted-foreground">
				{stats.unscored} left to score | {stats.accepted} accepted · {stats.rejected} rejected ·
				{stats.waitlisted} waitlisted | {pendingCount} pending release
			</span>
		</div>
		<Button size="sm" onclick={() => (showRubricEditor = true)}>
			{rubric.length > 0 ? 'Edit rubrics' : 'Set up rubrics'}
		</Button>
	</div>

	<!--
	The tabs are a fixed-size row of a column exactly one workspace tall, and the pane
	below takes whatever is left. Stacking them above a `workspace-h` pane instead
	would push the score field off the screen.

	The counts that used to sit here as four tiles now live on one line under the page
	title. They cost 118px of reviewing surface to say what fits in a sentence.
-->
	<div class="flex flex-col md:workspace-h md:overflow-hidden">
		<Tabs
			tabs={[
				{ value: 'review', label: 'Review', badge: stats.unscored },
				{
					value: 'decide',
					label: 'Pending Decisions',
					badge: rankedUnfilteredTotal ?? stats.scored + stats.pending
				},
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
					facets={reviewFacets}
					{facetSelection}
					{onFacetsChange}
					{searchInfo}
					{onSuggestionSelect}
					{loading}
					collapsed={sidebarCollapsed}
					onToggleCollapse={() => (sidebarCollapsed = !sidebarCollapsed)}
					{presenceMap}
					selfClaimUid={session.phase === 'owned' || session.phase === 'warning'
						? selectedUid
						: null}
					page={applicantsPage}
					totalPages={applicantsTotalPages}
					total={applicantsTotal}
					onPageChange={goToApplicantsPage}
				/>

				<!-- Right detail pane. Below md it replaces the list when an applicant is selected,
					     and disappears entirely when none is. -->
				<div
					bind:this={paneEl}
					class="min-w-0 flex-1 flex-col md:flex md:overflow-hidden {selected ? 'flex' : 'hidden'}"
				>
					{#if selected}
						<ApplicantDetail
							applicant={selected}
							rubric={rubricForRole(rubric, selected.role)}
							maxScore={maxScoreFor(selected.role)}
							onSaveScore={handleSaveScore}
							onSaveRubricScore={handleSaveRubricScore}
							onDecide={handleReviewDecide}
							{scoreLoading}
							decideLoading={reviewDeciding}
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
						{decideTotal} pending or scored
					</span>
					<div class="flex gap-2">
						<button
							onclick={() => openReleaseModal('selected')}
							disabled={selectedWithPending.length === 0}
							class="cursor-pointer rounded-md border border-destructive bg-transparent px-[14px] py-[7px] text-xs font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-40"
						>
							Release Selected
						</button>
						<button
							onclick={() => openReleaseModal('decide')}
							disabled={decidePending === 0}
							class="cursor-pointer rounded-md border-none bg-destructive px-[14px] py-[7px] text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
						>
							Release All
						</button>
					</div>
				</div>

				{#if decideFacets.length > 0}
					<div class="mb-3 rounded-md border border-border bg-white">
						<div class="flex items-stretch">
							<button
								type="button"
								onclick={() => (decideFiltersOpen = !decideFiltersOpen)}
								aria-expanded={decideFiltersOpen}
								class="flex flex-1 cursor-pointer items-center justify-between gap-2 border-none
							       bg-transparent px-3 py-2 text-left text-xs text-foreground-secondary
							       transition-colors hover:text-foreground focus-visible:shadow-ring"
							>
								<span class="flex items-center gap-1.5">
									Filters
									{#if decideActiveFilterCount > 0}
										<span
											class="rounded-sm bg-primary px-1 font-mono text-2xs text-primary-foreground tabular-nums"
										>
											{decideActiveFilterCount}
										</span>
									{/if}
								</span>
								<span
									aria-hidden="true"
									class="inline-block text-md leading-none transition-transform duration-150 ease-out-quick {decideFiltersOpen
										? ''
										: '-rotate-90'}">▾</span
								>
							</button>
							{#if decideActiveFilterCount > 0}
								<button
									type="button"
									onclick={() => {
										decideFacetSelection = {};
										loadRanked();
									}}
									class="shrink-0 cursor-pointer border-none bg-transparent px-3 text-2xs
								       text-foreground-tertiary underline transition-colors hover:text-foreground
								       focus-visible:shadow-ring"
								>
									Clear
								</button>
							{/if}
						</div>
						{#if decideFiltersOpen}
							<div class="max-h-64 overflow-y-auto border-t border-border-subtle px-3 py-3">
								<FacetFilters
									facets={decideFacets}
									selected={decideFacetSelection}
									onChange={(next) => {
										decideFacetSelection = next;
										loadRanked();
									}}
								/>
							</div>
						{/if}
					</div>
				{/if}

				<RankedList
					applicants={ranked.filter((a) => !a.activeDecision)}
					loading={rankedLoading}
					{deciding}
					{releasingOne}
					unscoredCount={stats.unscored}
					{maxScoreFor}
					rubricForRole={rubricForRoleLocal}
					onDecide={handleDecide}
					onClear={handleClear}
					onReleaseOne={handleReleaseOne}
					onRescore={handleRescore}
					onSaveRubricScore={handleRankedRubricScore}
					onSelectionChange={(uids) => (rankedSelected = uids)}
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
					{maxScoreFor}
					onDecide={handleReconsiderDecide}
					onClear={handleReconsiderClear}
					onReleaseOne={handleReconsiderReleaseOne}
					onRescore={handleRescore}
				/>
			</div>
		{:else}
			<div class="md:min-h-0 md:flex-1 md:overflow-y-auto">
				<ReviewerStats {reviewers} loading={reviewersLoading} {stats} {decisionStats} {scaleHint} />
			</div>
		{/if}
	</div>
{/if}

<!-- Mounted per editing session so the draft reseeds from the saved rubric each open. -->
{#if showRubricEditor}
	<RubricEditorModal
		criteria={rubric}
		saving={rubricSaving}
		onSave={handleSaveRubric}
		onClose={() => {
			if (!rubricSaving) showRubricEditor = false;
		}}
	/>
{/if}

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

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
