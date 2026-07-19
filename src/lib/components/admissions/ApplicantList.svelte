<script lang="ts">
	let {
		applicants,
		selectedUid,
		onSelect,
		roleTab,
		onRoleTabChange,
		search,
		onSearchInput,
		loading,
		collapsed,
		onToggleCollapse
	}: {
		applicants: Array<{
			uid: string;
			name: string;
			email: string;
			roles: string[];
			pendingDecision: string | null;
			blacklisted: boolean;
			createdAt: Date | string;
		}>;
		selectedUid: string | null;
		onSelect: (uid: string) => void;
		roleTab: string;
		onRoleTabChange: (tab: string) => void;
		search: string;
		onSearchInput: (value: string) => void;
		loading: boolean;
		collapsed: boolean;
		onToggleCollapse: () => void;
	} = $props();

	const ROLE_TABS = [
		{ key: 'ALL', label: 'All' },
		{ key: 'HACKER', label: 'Hackers' },
		{ key: 'JUDGE', label: 'Judges' },
		{ key: 'MENTOR', label: 'Mentors' },
		{ key: 'VOLUNTEER', label: 'Volunteers' }
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

<div
	class="flex shrink-0 flex-col overflow-hidden border-r border-border transition-[width] duration-200 ease-[ease]"
	style="width:{collapsed ? '44px' : '300px'};"
>
	{#if collapsed}
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
				{#each ROLE_TABS as tab}
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
			<!-- Collapse toggle -->
			<button
				onclick={onToggleCollapse}
				title="Collapse sidebar"
				class="shrink-0 cursor-pointer border-l border-none border-border bg-transparent px-[10px] text-sm text-muted-foreground"
			>
				‹
			</button>
		</div>

		<!-- Search -->
		<div class="shrink-0 border-b border-border px-3 py-[10px]">
			<input
				type="text"
				placeholder="Search by name or email…"
				value={search}
				oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded border border-border bg-[#f9f9f9] px-[10px] py-1.5 text-xs text-primary outline-none"
			/>
		</div>

		<!-- List -->
		<div class="flex-1 overflow-y-auto transition-opacity" class:opacity-50={loading}>
			{#if applicants.length === 0}
				<div class="px-4 py-8 text-center text-xs text-muted-foreground">
					{loading ? 'Loading…' : 'No applicants found'}
				</div>
			{:else}
				{#each applicants as applicant (applicant.uid)}
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
								{#if applicant.blacklisted}
									<span
										class="inline-flex items-center gap-0.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase"
									>
										⚠ Blacklisted
									</span>
								{/if}
								{#if applicant.pendingDecision}
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
						{#if applicant.roles.length}
							<div class="mt-0.5 text-[11px] text-muted-foreground">
								{applicant.roles[0].charAt(0) + applicant.roles[0].slice(1).toLowerCase()}
							</div>
						{/if}
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
