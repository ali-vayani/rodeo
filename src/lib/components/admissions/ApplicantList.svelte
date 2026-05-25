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

	const DECISION_BG: Record<string, string> = {
		ACCEPTED: '#d1fae5',
		WAITLISTED: '#fef9c3',
		REJECTED: '#fee2e2',
		PENDING: '#e5e7eb'
	};
	const DECISION_FG: Record<string, string> = {
		ACCEPTED: '#065f46',
		WAITLISTED: '#713f12',
		REJECTED: '#991b1b',
		PENDING: '#374151'
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
	style="flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid #e0e0e0; transition:width 0.2s ease; overflow:hidden; width:{collapsed ? '44px' : '300px'};"
>
	{#if collapsed}
		<!-- Collapsed strip -->
		<div style="display:flex; flex-direction:column; align-items:center; padding:10px 0; gap:8px;">
			<button
				onclick={onToggleCollapse}
				title="Expand sidebar"
				style="width:28px; height:28px; display:flex; align-items:center; justify-content:center; background:none; border:1px solid #e0e0e0; border-radius:4px; cursor:pointer; font-size:14px; color:#191919;"
			>
				›
			</button>
			<span
				style="font-size:10px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; writing-mode:vertical-rl; text-orientation:mixed; margin-top:8px;"
			>
				{applicants.length}
			</span>
		</div>
	{:else}
		<!-- Role tabs + collapse button -->
		<div
			style="display:flex; align-items:stretch; border-bottom:1px solid #e0e0e0; flex-shrink:0; overflow-x:hidden;"
		>
			<div style="display:flex; flex:1; overflow-x:auto;">
				{#each ROLE_TABS as tab}
					<button
						onclick={() => onRoleTabChange(tab.key)}
						style="padding:10px 10px; font-size:11px; font-weight:{roleTab === tab.key
							? '600'
							: '400'}; color:{roleTab === tab.key
							? '#191919'
							: '#aaaaaa'}; background:none; border:none; border-bottom:{roleTab === tab.key
							? '2px solid #191919'
							: '2px solid transparent'}; cursor:pointer; white-space:nowrap; transition:color 0.1s; flex-shrink:0;"
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<!-- Collapse toggle -->
			<button
				onclick={onToggleCollapse}
				title="Collapse sidebar"
				style="flex-shrink:0; padding:0 10px; background:none; border:none; border-left:1px solid #e0e0e0; cursor:pointer; color:#aaaaaa; font-size:14px;"
			>
				‹
			</button>
		</div>

		<!-- Search -->
		<div style="padding:10px 12px; border-bottom:1px solid #e0e0e0; flex-shrink:0;">
			<input
				type="text"
				placeholder="Search by name or email…"
				value={search}
				oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
				style="width:100%; font-size:12px; color:#191919; background:#f9f9f9; border:1px solid #e0e0e0; border-radius:4px; padding:6px 10px; outline:none; box-sizing:border-box;"
			/>
		</div>

		<!-- List -->
		<div style="flex:1; overflow-y:auto; opacity:{loading ? 0.5 : 1}; transition:opacity 0.15s;">
			{#if applicants.length === 0}
				<div style="padding:32px 16px; text-align:center; font-size:12px; color:#aaaaaa;">
					{loading ? 'Loading…' : 'No applicants found'}
				</div>
			{:else}
				{#each applicants as applicant (applicant.uid)}
					<button
						onclick={() => onSelect(applicant.uid)}
						style="width:100%; text-align:left; background:{selectedUid === applicant.uid
							? '#ebebeb'
							: '#fff'}; border:none; border-bottom:1px solid #f0f0f0; padding:12px 16px; cursor:pointer; display:block; transition:background 0.1s;"
						onmouseenter={(e) => {
							if (selectedUid !== applicant.uid)
								(e.currentTarget as HTMLElement).style.background = '#f5f5f5';
						}}
						onmouseleave={(e) => {
							if (selectedUid !== applicant.uid)
								(e.currentTarget as HTMLElement).style.background = '#fff';
						}}
					>
						<!-- Row top: name + decision chip -->
						<div
							style="display:flex; align-items:center; justify-content:space-between; gap:6px;"
						>
							<span
								style="font-size:13px; font-weight:500; color:#191919; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
							>
								{applicant.name}
							</span>
							{#if applicant.pendingDecision}
								<span
									style="flex-shrink:0; display:inline-block; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600; background:{DECISION_BG[applicant.pendingDecision] ?? '#e5e7eb'}; color:{DECISION_FG[applicant.pendingDecision] ?? '#374151'};"
								>
									{decLabel(applicant.pendingDecision)}
								</span>
							{/if}
						</div>
						<!-- Row middle: role -->
						{#if applicant.roles.length}
							<div style="font-size:11px; color:#aaaaaa; margin-top:2px;">
								{applicant.roles[0].charAt(0) + applicant.roles[0].slice(1).toLowerCase()}
							</div>
						{/if}
						<!-- Row bottom: applied date -->
						<div
							style="font-size:11px; color:#cccccc; margin-top:1px; font-family:'DM Mono', monospace;"
						>
							{formatShortDate(applicant.createdAt)}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
