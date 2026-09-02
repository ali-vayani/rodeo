<script lang="ts">
	import { ALL_ROLES, ALL_STATUSES, DECISION_OPTIONS } from '$lib/admin/filters';
	import FacetFilters from '$lib/components/admin/FacetFilters.svelte';
	import type { Facet, FacetState } from '$lib/facets';

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
		pendingFilter,
		onTogglePending,
		onClearPending,
		// Users-page sidebar default; the custom-email wizard overrides it to render inline.
		// md:w-60, not narrower: the facet combobox popover is anchored to the control
		// width, and at 168px every university row truncated.
		class:
			className = 'w-full shrink-0 border-b border-border bg-white px-4 py-4 md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:py-5',
		columns = false,
		showHeading = true,
		collapsible = false,
		facets = [],
		selection = $bindable({}),
		onSelectionChange = undefined
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
		pendingFilter: Record<string, boolean>;
		onTogglePending: (d: string) => void;
		onClearPending: () => void;
		class?: string;
		/** Side by side instead of stacked. */
		columns?: boolean;
		showHeading?: boolean;
		/** Below md, fold behind a Filters toggle. No effect from md up. */
		collapsible?: boolean;
		/** Empty renders nothing. */
		facets?: Facet[];
		/**
		 * Empty means "no filter", the opposite of the checkbox groups above.
		 * `facetParams` in `$lib/admin/filters` reconciles the two for the wire.
		 */
		selection?: FacetState;
		onSelectionChange?: (selected: FacetState) => void;
	} = $props();

	// Collapsed on phones so the list doesn't push results below the fold.
	let expanded = $state(false);

	const ROLES = ALL_ROLES;
	const STATUSES = ALL_STATUSES;
	const DECISIONS = DECISION_OPTIONS;

	function label(v: string): string {
		return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
	}

	let groups = $derived([
		{
			key: 'role',
			title: 'Role',
			options: ROLES as readonly string[],
			state: roleFilter,
			onToggle: onToggleRole,
			onClear: onClearRole,
			optionLabel: label
		},
		{
			key: 'status',
			title: 'Status',
			options: STATUSES as readonly string[],
			state: statusFilter,
			onToggle: onToggleStatus,
			onClear: onClearStatus,
			optionLabel: label
		},
		// Pending before released, matching the order decisions move through.
		{
			key: 'pending',
			title: 'Pending decision',
			options: DECISIONS as readonly string[],
			state: pendingFilter,
			onToggle: onTogglePending,
			onClear: onClearPending,
			optionLabel: (d: string) => (d === 'NONE' ? 'None' : label(d))
		},
		{
			key: 'decision',
			title: 'Released decision',
			options: DECISIONS as readonly string[],
			state: decisionFilter,
			onToggle: onToggleDecision,
			onClear: onClearDecision,
			optionLabel: (d: string) => (d === 'NONE' ? 'None' : label(d))
		}
	]);

	// Absent means collapsed; the badge on a folded group says it is still narrowing.
	let openGroups = $state<Record<string, boolean>>({});

	const uid = $props.id();
	const panelId = (key: string) => `${uid}-${key}`;

	// "All checked" and "none checked" both mean no filter; only a partial count narrows.
	function checkedCount(options: readonly string[], state: Record<string, boolean>): number {
		return options.filter((o) => state[o] ?? true).length;
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
		{#each groups as group, index (group.key)}
			{@const open = openGroups[group.key] ?? false}
			{@const checked = checkedCount(group.options, group.state)}
			<!-- No bottom margin on the last group: the facets below bring their own border and padding. -->
			<div class={index === groups.length - 1 ? (columns ? groupClass : '') : groupClass}>
				<div class="mb-2 flex items-center justify-between gap-2">
					<button
						type="button"
						onclick={() => (openGroups[group.key] = !open)}
						aria-expanded={open}
						aria-controls={panelId(group.key)}
						class="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-none bg-transparent p-0 text-left focus-visible:shadow-ring"
					>
						<span
							aria-hidden="true"
							class="inline-block text-md leading-none text-muted-foreground transition-transform duration-150 ease-out-quick {open
								? ''
								: '-rotate-90'}"
						>
							▾
						</span>
						<span class="text-2xs font-bold tracking-eyebrow text-muted-foreground uppercase">
							{group.title}
						</span>
						<!-- Folded shut, this badge is the only sign the group is narrowing the table. -->
						{#if checked > 0 && checked < group.options.length}
							<span
								class="rounded-sm bg-primary px-1 font-mono text-2xs leading-normal text-primary-foreground tabular-nums"
							>
								{checked}/{group.options.length}
							</span>
						{/if}
					</button>
					<button
						onclick={group.onClear}
						class="cursor-pointer border-none bg-transparent p-0 text-2xs leading-none text-muted-foreground transition-colors hover:text-primary focus-visible:shadow-ring"
						>clear</button
					>
				</div>
				{#if open}
					<div id={panelId(group.key)}>
						{#each group.options as option (option)}
							<label class="flex cursor-pointer items-center gap-2 py-[3px] text-xs text-[#333]">
								<input
									type="checkbox"
									checked={group.state[option] ?? true}
									onchange={() => group.onToggle(option)}
									class="cursor-pointer accent-primary"
								/>
								{group.optionLabel(option)}
							</label>
						{/each}
					</div>
				{/if}
			</div>
		{/each}

		<!-- `collapsible` is not forwarded: the wrapper is already hidden by the Filters
		     toggle above. `basis-full` gives it its own row in columns mode. -->
		<FacetFilters
			{facets}
			bind:selected={selection}
			onChange={onSelectionChange}
			{columns}
			heading="Application"
			class={columns
				? 'basis-full border-t border-border-subtle pt-5'
				: 'border-t border-border-subtle pt-5'}
		/>
	</div>
</div>
