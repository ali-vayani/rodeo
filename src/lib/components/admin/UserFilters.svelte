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

<div class="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-white px-4 py-5">
	<div class="mb-3 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
		Filters
	</div>

	<!-- Role -->
	<div class="mb-5">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Role</span
			>
			<button
				onclick={onClearRole}
				class="cursor-pointer border-none bg-transparent p-0 text-[10px] leading-none text-muted-foreground transition-colors hover:text-primary"
				>clear</button
			>
		</div>
		{#each ROLES as role}
			<label class="flex cursor-pointer items-center gap-2 py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={roleFilter[role] ?? true}
					onchange={() => onToggleRole(role)}
					class="cursor-pointer accent-primary"
				/>
				{label(role)}
			</label>
		{/each}
	</div>

	<!-- Status -->
	<div class="mb-5">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
				>Status</span
			>
			<button
				onclick={onClearStatus}
				class="cursor-pointer border-none bg-transparent p-0 text-[10px] leading-none text-muted-foreground transition-colors hover:text-primary"
				>clear</button
			>
		</div>
		{#each STATUSES as status}
			<label class="flex cursor-pointer items-center gap-2 py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={statusFilter[status] ?? true}
					onchange={() => onToggleStatus(status)}
					class="cursor-pointer accent-primary"
				/>
				{label(status)}
			</label>
		{/each}
	</div>

	<!-- Decision -->
	<div>
		<div class="mb-2 flex items-center justify-between">
			<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
				>Decision</span
			>
			<button
				onclick={onClearDecision}
				class="cursor-pointer border-none bg-transparent p-0 text-[10px] leading-none text-muted-foreground transition-colors hover:text-primary"
				>clear</button
			>
		</div>
		{#each DECISIONS as decision}
			<label class="flex cursor-pointer items-center gap-2 py-[3px] text-xs text-[#333]">
				<input
					type="checkbox"
					checked={decisionFilter[decision] ?? true}
					onchange={() => onToggleDecision(decision)}
					class="cursor-pointer accent-primary"
				/>
				{decision === 'NONE' ? 'None' : label(decision)}
			</label>
		{/each}
	</div>
</div>
