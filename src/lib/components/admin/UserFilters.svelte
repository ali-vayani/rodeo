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
		// Defaults to the Users-page sidebar: a full-width strip stacked on top
		// below md, the fixed 200px left rail from md up. The custom-email wizard
		// overrides this to render the same controls inline.
		class:
			className = 'w-full shrink-0 border-b border-border bg-white px-4 py-4 md:w-50 md:overflow-y-auto md:border-r md:border-b-0 md:py-5',
		columns = false,
		showHeading = true,
		collapsible = false
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
		/** Below md, collapse the groups behind a Filters toggle. No effect from md up. */
		collapsible?: boolean;
	} = $props();

	// Collapsed by default on phones so the list doesn't push the results below
	// the fold. md and up ignores this entirely — the rail is always expanded.
	let expanded = $state(false);

	const ROLES = ALL_ROLES;
	const STATUSES = ALL_STATUSES;
	const DECISIONS = DECISION_OPTIONS;

	function label(v: string): string {
		return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
	}

	let groupClass = $derived(columns ? 'flex-1 min-w-[150px]' : 'mb-5');
</script>

<div class={className}>
	{#if collapsible}
		<button
			type="button"
			onclick={() => (expanded = !expanded)}
			aria-expanded={expanded}
			class="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-0 text-left md:hidden"
		>
			<span class="text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
				Filters
			</span>
			<span class="text-xs text-muted-foreground">{expanded ? 'Hide' : 'Show'}</span>
		</button>
	{/if}
	{#if showHeading}
		<div
			class="mb-3 text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase {collapsible
				? 'hidden md:block'
				: ''}"
		>
			Filters
		</div>
	{/if}

	<div
		class="{columns ? 'flex flex-wrap gap-8' : ''} {collapsible && !expanded
			? 'hidden md:block'
			: ''} {collapsible && expanded ? 'mt-4 md:mt-0' : ''}"
	>
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
