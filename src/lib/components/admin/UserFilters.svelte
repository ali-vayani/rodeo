<script lang="ts">
	let {
		roleFilter,
		onToggleRole,
		onClearRole,
		statusFilter,
		onToggleStatus,
		onClearStatus,
		decisionFilter,
		onToggleDecision,
		onClearDecision
	}: {
		roleFilter: Record<string, boolean>;
		onToggleRole: (r: string) => void;
		onClearRole: () => void;
		statusFilter: Record<string, boolean>;
		onToggleStatus: (s: string) => void;
		onClearStatus: () => void;
		decisionFilter: Record<string, boolean>;
		onToggleDecision: (d: string) => void;
		onClearDecision: () => void;
	} = $props();

	const ROLES = ['HACKER', 'JUDGE', 'MENTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN', 'UNDECLARED'];
	const STATUSES = ['CREATED', 'APPLIED', 'CONFIRMED', 'DECLINED', 'CHECKED_IN'];
	const DECISIONS = ['ACCEPTED', 'WAITLISTED', 'REJECTED', 'PENDING', 'NONE'];

	function label(v: string): string {
		return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
	}
</script>

<div style="width:200px; flex-shrink:0; background:#fff; border-right:1px solid #e0e0e0; padding:20px 16px; overflow-y:auto;">
	<div
		style="font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#aaaaaa; margin-bottom:12px;"
	>
		Filters
	</div>

	<!-- Role -->
	<div style="margin-bottom:20px;">
		<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
			<span
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa;"
			>Role</span>
			<button
				onclick={onClearRole}
				style="font-size:10px; color:#aaaaaa; background:none; border:none; cursor:pointer; padding:0; line-height:1;"
				onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.color = '#191919')}
				onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.color = '#aaaaaa')}
			>clear</button>
		</div>
		{#each ROLES as role}
			<label
				style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:3px 0; font-size:12px; color:#333;"
			>
				<input
					type="checkbox"
					checked={roleFilter[role] ?? true}
					onchange={() => onToggleRole(role)}
					style="accent-color:#191919; cursor:pointer;"
				/>
				{label(role)}
			</label>
		{/each}
	</div>

	<!-- Status -->
	<div style="margin-bottom:20px;">
		<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
			<span
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa;"
			>Status</span>
			<button
				onclick={onClearStatus}
				style="font-size:10px; color:#aaaaaa; background:none; border:none; cursor:pointer; padding:0; line-height:1;"
				onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.color = '#191919')}
				onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.color = '#aaaaaa')}
			>clear</button>
		</div>
		{#each STATUSES as status}
			<label
				style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:3px 0; font-size:12px; color:#333;"
			>
				<input
					type="checkbox"
					checked={statusFilter[status] ?? true}
					onchange={() => onToggleStatus(status)}
					style="accent-color:#191919; cursor:pointer;"
				/>
				{label(status)}
			</label>
		{/each}
	</div>

	<!-- Decision -->
	<div>
		<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
			<span
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa;"
			>Decision</span>
			<button
				onclick={onClearDecision}
				style="font-size:10px; color:#aaaaaa; background:none; border:none; cursor:pointer; padding:0; line-height:1;"
				onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.color = '#191919')}
				onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.color = '#aaaaaa')}
			>clear</button>
		</div>
		{#each DECISIONS as decision}
			<label
				style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:3px 0; font-size:12px; color:#333;"
			>
				<input
					type="checkbox"
					checked={decisionFilter[decision] ?? true}
					onchange={() => onToggleDecision(decision)}
					style="accent-color:#191919; cursor:pointer;"
				/>
				{decision === 'NONE' ? 'None' : label(decision)}
			</label>
		{/each}
	</div>
</div>
