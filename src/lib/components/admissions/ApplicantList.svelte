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
	class="shrink-0 flex flex-col border-r border-border overflow-hidden transition-[width] duration-200 ease-[ease]"
	style="width:{collapsed ? '44px' : '300px'};"
>
	{#if collapsed}
		<!-- Collapsed strip -->
		<div class="flex flex-col items-center py-[10px] gap-2">
			<button
				onclick={onToggleCollapse}
				title="Expand sidebar"
				class="w-7 h-7 flex items-center justify-center bg-transparent border border-border rounded cursor-pointer text-sm text-primary"
			>
				›
			</button>
			<span class="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground [writing-mode:vertical-rl] mt-2">
				{applicants.length}
			</span>
		</div>
	{:else}
		<!-- Role tabs + collapse button -->
		<div class="flex items-stretch border-b border-border shrink-0 overflow-x-hidden">
			<div class="flex flex-1 overflow-x-auto">
				{#each ROLE_TABS as tab}
					<button
						onclick={() => onRoleTabChange(tab.key)}
						class="px-[10px] py-[10px] text-[11px] whitespace-nowrap shrink-0 bg-transparent border-none cursor-pointer transition-colors border-b-2 {roleTab === tab.key ? 'font-semibold text-primary border-b-primary' : 'font-normal text-muted-foreground border-b-transparent'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<!-- Collapse toggle -->
			<button
				onclick={onToggleCollapse}
				title="Collapse sidebar"
				class="shrink-0 px-[10px] bg-transparent border-none border-l border-border cursor-pointer text-muted-foreground text-sm"
			>
				‹
			</button>
		</div>

		<!-- Search -->
		<div class="px-3 py-[10px] border-b border-border shrink-0">
			<input
				type="text"
				placeholder="Search by name or email…"
				value={search}
				oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
				class="w-full text-xs text-primary bg-[#f9f9f9] border border-border rounded px-[10px] py-1.5 outline-none"
			/>
		</div>

		<!-- List -->
		<div
			class="flex-1 overflow-y-auto transition-opacity"
			class:opacity-50={loading}
		>
			{#if applicants.length === 0}
				<div class="px-4 py-8 text-center text-xs text-muted-foreground">
					{loading ? 'Loading…' : 'No applicants found'}
				</div>
			{:else}
				{#each applicants as applicant (applicant.uid)}
					<button
						onclick={() => onSelect(applicant.uid)}
						class="w-full text-left border-none border-b border-[#f0f0f0] px-4 py-3 cursor-pointer block transition-colors {selectedUid === applicant.uid ? 'bg-[#ebebeb]' : 'bg-white hover:bg-[#f5f5f5]'}"
					>
						<!-- Row top: name + decision chip -->
						<div class="flex items-center justify-between gap-1.5">
							<span class="text-[13px] font-medium text-primary truncate">
								{applicant.name}
							</span>
							{#if applicant.pendingDecision}
								<span class="shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold {DECISION_CLASS[applicant.pendingDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
									{decLabel(applicant.pendingDecision)}
								</span>
							{/if}
						</div>
						<!-- Row middle: role -->
						{#if applicant.roles.length}
							<div class="text-[11px] text-muted-foreground mt-0.5">
								{applicant.roles[0].charAt(0) + applicant.roles[0].slice(1).toLowerCase()}
							</div>
						{/if}
						<!-- Row bottom: applied date -->
						<div class="text-[11px] text-[#cccccc] mt-px font-mono">
							{formatShortDate(applicant.createdAt)}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
