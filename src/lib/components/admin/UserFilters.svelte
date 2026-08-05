<script lang="ts">
	import { ALL_ROLES, ALL_STATUSES, DECISION_OPTIONS } from '$lib/admin/filters';

	let {
		roleFilter,
		onToggleRole,
		onClearRole,
		statusFilter,
		onToggleStatus,
		onClearStatus,
		decisionFilter,
		onToggleDecision,
		onClearDecision,
		// Defaults to the Users-page sidebar. The custom-email wizard overrides this
		// to render the same controls inline.
		class:
			className = 'w-[200px] shrink-0 bg-white border-r border-border px-4 py-5 overflow-y-auto',
		columns = false,
		showHeading = true
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
		class?: string;
		/** Lay the three groups out side by side instead of stacked. */
		columns?: boolean;
		showHeading?: boolean;
	} = $props();

	const ROLES = ALL_ROLES;
	const STATUSES = ALL_STATUSES;
	const DECISIONS = DECISION_OPTIONS;

	function label(v: string): string {
		return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
	}

	let groupClass = $derived(columns ? 'flex-1 min-w-[150px]' : 'mb-5');
</script>

<div class={className}>
	{#if showHeading}
		<div class="mb-3 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
			Filters
		</div>
	{/if}

	<div class={columns ? 'flex flex-wrap gap-8' : ''}>
		<!-- Role -->
		<div class={groupClass}>
			<div class="mb-2 flex items-center justify-between">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
					>Role</span
				>
				<button
					onclick={onClearRole}
					class="cursor-pointer border-none bg-transparent p-0 text-[10px] leading-none text-muted-foreground transition-colors hover:text-primary"
					>clear</button
				>
			</div>
			{#each ROLES as role (role)}
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
		<div class={groupClass}>
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
			{#each STATUSES as status (status)}
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
		<div class={columns ? 'min-w-[150px] flex-1' : ''}>
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
			{#each DECISIONS as decision (decision)}
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
</div>
