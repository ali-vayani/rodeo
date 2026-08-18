<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import LinkedFieldFilters from '$lib/components/admin/LinkedFieldFilters.svelte';
	import type { ScoreFilter } from '$lib/admissions/score';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { Role } from '$lib/generated/prisma/enums';
	import type { LinkedFacet, LinkedField } from '$lib/linkedFields';

	let {
		applicants,
		selectedUid,
		onSelect,
		roleTab,
		onRoleTabChange,
		search,
		onSearchInput,
		scoreFilter,
		onScoreFilterChange,
		facets,
		linkedSelected,
		onLinkedFiltersChange,
		searchInfo,
		onSuggestionSelect,
		loading,
		collapsed,
		onToggleCollapse,
		presenceMap,
		selfClaimUid
	}: {
		applicants: Array<{
			uid: string;
			name: string;
			email: string;
			role: string;
			score: number | null;
			pendingDecision: string | null;
			blacklistMatch: BlacklistMatch | null;
			createdAt: Date | string;
		}>;
		selectedUid: string | null;
		onSelect: (uid: string) => void;
		roleTab: Role | 'ALL';
		onRoleTabChange: (tab: Role | 'ALL') => void;
		search: string;
		onSearchInput: (value: string) => void;
		/**
		 * Which half of the queue is on screen. Defaults to `unscored` — the pass is
		 * "work until this list is empty" — but scored applicants have to stay
		 * reachable or a mistyped score would be uncorrectable from the UI.
		 */
		scoreFilter: ScoreFilter;
		onScoreFilterChange: (value: ScoreFilter) => void;
		/** One per application question that writes through to a `User` column. */
		facets: LinkedFacet[];
		linkedSelected: Partial<Record<LinkedField, string[]>>;
		onLinkedFiltersChange: (selected: Partial<Record<LinkedField, string[]>>) => void;
		/**
		 * What the last query did with the search term. `names` is ranked most-relevant
		 * first; the rows below are `createdAt desc` and are not, which is why the
		 * suggestions are a strip of their own rather than a reordering of the list.
		 */
		searchInfo: { names: string[]; fuzzy: boolean; capped: boolean; exact: number };
		onSuggestionSelect: (name: string) => void;
		loading: boolean;
		collapsed: boolean;
		onToggleCollapse: () => void;
		presenceMap: Record<string, string>;
		/** presenceMap excludes yourself, so this is the only signal that you hold a lock. */
		selfClaimUid: string | null;
	} = $props();

	// The collapsed rail is a desktop-only affordance — below md the list is a
	// full-width stacked view and a 44px strip would be useless. Gate on the
	// same 48rem breakpoint as `md:` so a collapse toggled on desktop doesn't
	// leave a shrunken list behind after resizing down.
	const mdUp = new MediaQuery('(min-width: 48rem)');
	let isCollapsed = $derived(collapsed && mdUp.current);

	/**
	 * The filter panel is a disclosure at every width, not just on phones.
	 *
	 * `LinkedFieldFilters` has a `collapsible` of its own, but it only folds below md —
	 * right for a full-width page, wrong here. This column is 300px wide and already
	 * spends its first two rows on tabs and a search box; three facets open underneath
	 * them (two comboboxes and a six-row checkbox list) push the queue itself off a
	 * laptop screen. So the disclosure is owned here and applies at all breakpoints,
	 * and the panel is capped and scrolls rather than growing without bound.
	 *
	 * `LinkedFieldFilters` now folds each facet individually as well. The two are one
	 * mechanism at two scales, not two competing ones: this toggle decides whether the
	 * panel is on screen at all, and only once it is do the per-facet folds inside it
	 * mean anything. `collapsible` is still not forwarded — a third, breakpoint-gated
	 * toggle for the same panel is the one combination that would fight.
	 *
	 * Shut on arrival, deliberately: the per-facet folds start open, so opening this
	 * shows every facet, and nothing about the first paint of the queue changes.
	 */
	let filtersOpen = $state(false);

	/** How many values are selected across every facet — the badge on a shut panel. */
	let activeFilterCount = $derived(
		Object.values(linkedSelected).reduce((total, values) => total + (values?.length ?? 0), 0)
	);

	/**
	 * Shown only when there is something to suggest.
	 *
	 * `fuzzy` means the fold ran, not that it found anything: a term matching nobody and
	 * resembling nobody still sets it, and "did you mean:" followed by nothing is worse
	 * than the plain empty state.
	 */
	let showSuggestions = $derived(searchInfo.fuzzy && searchInfo.names.length > 0);

	/**
	 * The wording follows `exact`, not `fuzzy`.
	 *
	 * `fuzzy` only says the fold ran, and it runs below a floor of five rather than at
	 * zero — so on a queue this size it runs constantly over terms that DID match. Keying
	 * the sentence off it put "No exact match" above three people named Vayani, which
	 * reads as a broken search rather than a suggestion.
	 */
	let suggestionsPrefix = $derived(
		searchInfo.exact > 0 ? 'Similar names:' : 'No exact match — did you mean:'
	);

	/**
	 * Built here rather than in markup so the sentence keeps its spacing — Svelte trims
	 * whitespace at an `{#if}` boundary, which glued the cap onto the colon.
	 *
	 * The cap is stated, never hidden: a list that stopped at 25 is a different answer
	 * from one that ran out, and an organizer who can't find their person needs to know
	 * which of the two they are looking at.
	 */
	let suggestionsLabel = $derived(
		searchInfo.capped
			? `${suggestionsPrefix} (showing the ${searchInfo.names.length} closest)`
			: suggestionsPrefix
	);

	function clearLinkedFilters() {
		onLinkedFiltersChange({});
	}

	const uid = $props.id();
	const filtersPanelId = `${uid}-filters`;

	const ROLE_TABS = [
		{ key: 'ALL', label: 'All' },
		{ key: 'HACKER', label: 'Hackers' },
		{ key: 'JUDGE', label: 'Judges' },
		{ key: 'MENTOR', label: 'Mentors' },
		{ key: 'VOLUNTEER', label: 'Volunteers' }
	] as const;

	const SCORE_FILTERS: ReadonlyArray<{ key: ScoreFilter; label: string }> = [
		{ key: 'unscored', label: 'To score' },
		{ key: 'scored', label: 'Scored' },
		{ key: 'all', label: 'All' }
	];

	const DECISION_CLASS: Record<string, string> = {
		ACCEPTED: 'bg-[#d1fae5] text-[#065f46]',
		WAITLISTED: 'bg-[#fef9c3] text-[#713f12]',
		REJECTED: 'bg-[#fee2e2] text-[#991b1b]',
		PENDING: 'bg-[#e5e7eb] text-[#374151]'
	};

	function decLabel(d: string | null): string {
		if (!d) return '';
		return d.charAt(0) + d.slice(1).toLowerCase();
	}

	function formatShortDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<!-- Full-width below md (hidden once an applicant is open — the detail view
     takes over); the classic 300px/44px rail from md up. -->
<div
	class="w-full shrink-0 flex-col overflow-hidden border-border transition-[width] duration-200 ease-[ease] md:flex md:border-r {selectedUid
		? 'hidden'
		: 'flex'} {isCollapsed ? 'md:w-11' : 'md:w-75'}"
>
	{#if isCollapsed}
		<!-- Collapsed strip -->
		<div class="flex flex-col items-center gap-2 py-[10px]">
			<button
				onclick={onToggleCollapse}
				title="Expand sidebar"
				class="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border bg-transparent text-sm text-primary"
			>
				›
			</button>
			<span
				class="mt-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase [writing-mode:vertical-rl]"
			>
				{applicants.length}
			</span>
		</div>
	{:else}
		<!-- Role tabs + collapse button -->
		<div class="flex shrink-0 items-stretch overflow-x-hidden border-b border-border">
			<div class="flex flex-1 overflow-x-auto">
				{#each ROLE_TABS as tab (tab.key)}
					<button
						onclick={() => onRoleTabChange(tab.key)}
						class="shrink-0 cursor-pointer border-b-2 border-none bg-transparent px-[10px] py-[10px] text-[11px] whitespace-nowrap transition-colors {roleTab ===
						tab.key
							? 'border-b-primary font-semibold text-primary'
							: 'border-b-transparent font-normal text-muted-foreground'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<!-- Collapse toggle (desktop rail only) -->
			<button
				onclick={onToggleCollapse}
				title="Collapse sidebar"
				class="hidden shrink-0 cursor-pointer border-l border-none border-border bg-transparent px-[10px] text-sm text-muted-foreground md:block"
			>
				‹
			</button>
		</div>

		<!-- Scored / unscored split, then search -->
		<div class="shrink-0 border-b border-border px-3 py-[10px]">
			<!-- Built from the same plain buttons as the role tabs directly above rather
			     than a shared control: the two sit two rows apart in a 300px rail and
			     have to read as one set of filters, not as two borrowed widgets. -->
			<div class="mb-2 flex gap-1" role="group" aria-label="Filter by scoring state">
				{#each SCORE_FILTERS as option (option.key)}
					<button
						type="button"
						aria-pressed={scoreFilter === option.key}
						onclick={() => onScoreFilterChange(option.key)}
						class="flex-1 cursor-pointer rounded border px-2 py-1 text-[11px] transition-colors
						       focus-visible:shadow-ring {scoreFilter === option.key
							? 'border-primary bg-primary font-semibold text-primary-foreground'
							: 'border-border bg-card text-muted-foreground hover:bg-[#f5f5f5]'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
			<input
				type="text"
				placeholder="Search by name or email…"
				value={search}
				oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded border border-border bg-[#f9f9f9] px-[10px] py-1.5 text-touch text-primary outline-none sm:text-xs"
			/>
		</div>

		<!--
			"Did you mean" — the fallback the server actually applied, in the order it
			ranked. Rendered as its own strip rather than folded into the list because
			the rows below are `createdAt desc`: reordering them to match this would
			imply a relevance the queue does not have.
		-->
		{#if showSuggestions}
			<div class="shrink-0 border-b border-border bg-muted px-3 py-2">
				<div class="text-2xs text-foreground-secondary">{suggestionsLabel}</div>
				<!--
					Capped and scrolled for the same reason the filter panel is: at the cap
					this is 25 full names, which wraps to ten-odd rows and would leave two
					applicants visible on a laptop. The strip corrects the search; the queue
					is still the thing on screen.
				-->
				<div class="mt-1.5 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
					{#each searchInfo.names as name (name)}
						{@const active = linkedSelected.NAME?.includes(name) ?? false}
						<button
							type="button"
							aria-pressed={active}
							onclick={() => onSuggestionSelect(name)}
							class="max-w-full cursor-pointer truncate rounded-sm border px-1.5 py-0.5 text-xs
							       transition-colors duration-150 focus-visible:shadow-ring {active
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-card text-foreground hover:bg-surface-hover'}"
						>
							{name}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Linked application fields, behind a disclosure so the queue stays in view -->
		{#if facets.length > 0}
			<div class="shrink-0 border-b border-border">
				<div class="flex items-stretch">
					<button
						type="button"
						onclick={() => (filtersOpen = !filtersOpen)}
						aria-expanded={filtersOpen}
						aria-controls={filtersPanelId}
						class="flex flex-1 cursor-pointer items-center justify-between gap-2 border-none
						       bg-transparent px-3 py-2 text-left text-xs text-foreground-secondary
						       transition-colors hover:text-foreground focus-visible:shadow-ring"
					>
						<span class="flex items-center gap-1.5">
							Filters
							<!--
								The count is what keeps a shut panel honest: a filter you cannot see
								is still narrowing the queue, and this is the only thing that says so.
							-->
							{#if activeFilterCount > 0}
								<span
									class="rounded-sm bg-primary px-1 font-mono text-2xs text-primary-foreground tabular-nums"
								>
									{activeFilterCount}
								</span>
							{/if}
						</span>
						<!-- Same rotating chevron as the per-facet folds inside the panel, so the
						     two read as one mechanism at two scales. -->
						<span
							aria-hidden="true"
							class="inline-block text-md leading-none transition-transform duration-150 ease-out-quick {filtersOpen
								? ''
								: '-rotate-90'}">▾</span
						>
					</button>
					{#if activeFilterCount > 0}
						<button
							type="button"
							onclick={clearLinkedFilters}
							class="shrink-0 cursor-pointer border-none bg-transparent px-3 text-2xs
							       text-foreground-tertiary underline transition-colors hover:text-foreground
							       focus-visible:shadow-ring"
						>
							Clear
						</button>
					{/if}
				</div>

				{#if filtersOpen}
					<div
						id={filtersPanelId}
						class="max-h-64 overflow-y-auto border-t border-border-subtle px-3 py-3"
					>
						<LinkedFieldFilters
							{facets}
							selected={linkedSelected}
							onChange={onLinkedFiltersChange}
						/>
					</div>
				{/if}
			</div>
		{/if}

		<!-- List -->
		<div class="flex-1 overflow-y-auto transition-opacity" class:opacity-50={loading}>
			{#if applicants.length === 0}
				<div class="px-4 py-8 text-center text-xs text-muted-foreground">
					{#if loading}
						Loading…
					{:else if activeFilterCount > 0}
						No applicants match these filters
					{:else}
						No applicants found
					{/if}
				</div>
			{:else}
				{#each applicants as applicant (applicant.uid)}
					{@const reviewer = presenceMap[applicant.uid]}
					<button
						onclick={() => onSelect(applicant.uid)}
						class="block w-full cursor-pointer border-b border-none border-[#f0f0f0] px-4 py-3 text-left transition-colors {selectedUid ===
						applicant.uid
							? 'bg-[#ebebeb]'
							: 'bg-white hover:bg-[#f5f5f5]'}"
					>
						<!-- Row top: name + decision chip -->
						<div class="flex items-center justify-between gap-1.5">
							<span class="truncate text-[13px] font-medium text-primary">
								{applicant.name}
							</span>
							<div class="flex shrink-0 items-center gap-1">
								{#if applicant.score !== null}
									<span
										class="inline-block rounded bg-[#eef2ff] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#3730a3] tabular-nums"
									>
										{applicant.score}
									</span>
								{/if}
								<BlacklistBadge match={applicant.blacklistMatch} />
								{#if applicant.uid === selfClaimUid}
									<span
										title="You are reviewing this applicant"
										class="inline-flex items-center gap-1 rounded bg-[#f0fdf4] px-1.5 py-0.5 text-[10px] font-medium text-[#16a34a]"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-[#16a34a]"></span>
										You
									</span>
								{/if}
								{#if reviewer}
									<span
										title="Being reviewed by {reviewer}"
										class="inline-flex items-center gap-1 rounded bg-[#e0f2fe] px-1.5 py-0.5 text-[10px] font-medium text-[#0369a1]"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-[#0ea5e9]"></span>
										Reviewing
									</span>
								{/if}
								<!-- A literal PENDING means untouched, not decided — chipping it
								     would put a badge on every row in the scoring queue. -->
								{#if applicant.pendingDecision && applicant.pendingDecision !== 'PENDING'}
									<span
										class="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold {DECISION_CLASS[
											applicant.pendingDecision
										] ?? 'bg-[#e5e7eb] text-[#374151]'}"
									>
										{decLabel(applicant.pendingDecision)}
									</span>
								{/if}
							</div>
						</div>
						<!-- Row middle: role -->
						<div class="mt-0.5 text-[11px] text-muted-foreground">
							{applicant.role.charAt(0) + applicant.role.slice(1).toLowerCase()}
						</div>
						<!-- Row bottom: applied date -->
						<div class="mt-px font-mono text-[11px] text-[#cccccc]">
							{formatShortDate(applicant.createdAt)}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
