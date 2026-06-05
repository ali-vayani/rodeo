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

<div class="w-[200px] shrink-0 bg-white border-r border-border px-4 py-5 overflow-y-auto">
	<div class="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-3">
		Filters
	</div>

	<!-- Role -->
	<div class="mb-5">
		<div class="flex items-center justify-between mb-2">
			<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Role</span>
			<button
				onclick={onClearRole}
				class="text-[10px] text-muted-foreground bg-transparent border-none cursor-pointer p-0 leading-none hover:text-primary transition-colors"
			>clear</button>
		</div>
		{#each ROLES as role}
			<label class="flex items-center gap-2 cursor-pointer py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={roleFilter[role] ?? true}
					onchange={() => onToggleRole(role)}
					class="accent-primary cursor-pointer"
				/>
				{label(role)}
			</label>
		{/each}
	</div>

	<!-- Status -->
	<div class="mb-5">
		<div class="flex items-center justify-between mb-2">
			<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Status</span>
			<button
				onclick={onClearStatus}
				class="text-[10px] text-muted-foreground bg-transparent border-none cursor-pointer p-0 leading-none hover:text-primary transition-colors"
			>clear</button>
		</div>
		{#each STATUSES as status}
			<label class="flex items-center gap-2 cursor-pointer py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={statusFilter[status] ?? true}
					onchange={() => onToggleStatus(status)}
					class="accent-primary cursor-pointer"
				/>
				{label(status)}
			</label>
		{/each}
	</div>

	<!-- Decision -->
	<div>
		<div class="flex items-center justify-between mb-2">
			<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Decision</span>
			<button
				onclick={onClearDecision}
				class="text-[10px] text-muted-foreground bg-transparent border-none cursor-pointer p-0 leading-none hover:text-primary transition-colors"
			>clear</button>
		</div>
		{#each DECISIONS as decision}
			<label class="flex items-center gap-2 cursor-pointer py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={decisionFilter[decision] ?? true}
					onchange={() => onToggleDecision(decision)}
					class="accent-primary cursor-pointer"
				/>
				{decision === 'NONE' ? 'None' : label(decision)}
			</label>
		{/each}
	</div>
</div>
