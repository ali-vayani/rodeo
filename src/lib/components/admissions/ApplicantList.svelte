<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import FacetFilters from '$lib/components/admin/FacetFilters.svelte';
	import type { ScoreFilter } from '$lib/admissions/score';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { Role } from '$lib/generated/prisma/enums';
	import { isEngaged, type Facet, type FacetState } from '$lib/facets';

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
		facetSelection,
		onFacetsChange,
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
		/** Scored applicants stay reachable or a mistyped score would be uncorrectable from the UI. */
		scoreFilter: ScoreFilter;
		onScoreFilterChange: (value: ScoreFilter) => void;
		/** One per application question that writes through to a `User` column. */
		facets: Facet[];
		facetSelection: FacetState;
		onFacetsChange: (selected: FacetState) => void;
		loading: boolean;
		collapsed: boolean;
		onToggleCollapse: () => void;
		presenceMap: Record<string, string>;
		/** presenceMap excludes yourself, so this is the only signal that you hold a lock. */
		selfClaimUid: string | null;
	} = $props();

	// Same 48rem breakpoint as `md:`, so a desktop collapse never leaves a shrunken list
	// behind after resizing down.
	const mdUp = new MediaQuery('(min-width: 48rem)');
	let isCollapsed = $derived(collapsed && mdUp.current);

	// A disclosure at every width, not `FacetFilters.collapsible` (below md only): three
	// open facets in a 300px column would push the queue off a laptop screen.
	let filtersOpen = $state(false);

	// Facets, not values: a substring box or a range is one filter however it is filled.
	let activeFilterCount = $derived(
		Object.values(facetSelection).filter((selection) => isEngaged(selection)).length
	);

	function clearFacetFilters() {
		onFacetsChange({});
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

<!-- Full-width below md, hidden once an applicant is open; a 300px/44px rail from md up. -->
<div
	class="w-full shrink-0 flex-col overflow-hidden border-border transition-[width] duration-200 ease-[ease] md:flex md:border-r {selectedUid
		? 'hidden'
		: 'flex'} {isCollapsed ? 'md:w-11' : 'md:w-75'}"
>
	{#if isCollapsed}
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
			<button
				onclick={onToggleCollapse}
				title="Collapse sidebar"
				class="hidden shrink-0 cursor-pointer border-l border-none border-border bg-transparent px-[10px] text-sm text-muted-foreground md:block"
			>
				‹
			</button>
		</div>

		<div class="shrink-0 border-b border-border px-3 py-[10px]">
			<!-- Same plain buttons as the role tabs, so the two rows read as one set of filters. -->
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
							<!-- A filter you cannot see is still narrowing the queue. -->
							{#if activeFilterCount > 0}
								<span
									class="rounded-sm bg-primary px-1 font-mono text-2xs text-primary-foreground tabular-nums"
								>
									{activeFilterCount}
								</span>
							{/if}
						</span>
						<!-- Same chevron as the per-facet folds inside, so both read as one mechanism. -->
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
							onclick={clearFacetFilters}
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
						<FacetFilters {facets} selected={facetSelection} onChange={onFacetsChange} />
					</div>
				{/if}
			</div>
		{/if}

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
								<!-- PENDING means untouched, not decided; chipping it would badge every row. -->
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
						<div class="mt-0.5 text-[11px] text-muted-foreground">
							{applicant.role.charAt(0) + applicant.role.slice(1).toLowerCase()}
						</div>
						<div class="mt-px font-mono text-[11px] text-[#cccccc]">
							{formatShortDate(applicant.createdAt)}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
