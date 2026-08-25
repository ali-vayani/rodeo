<script lang="ts">
	import { cn } from '$lib/utils';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Eyebrow from '$lib/components/ui/Eyebrow.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import {
		MAX_FACET_OPTIONS,
		NO_VALUE,
		isEngaged,
		splitNoValue,
		type Facet,
		type FacetSelection,
		type FacetState
	} from '$lib/facets';
	import type { MultiComboboxOption } from '$lib/components/ui/types';

	let {
		facets,
		selected = $bindable({}),
		onChange = undefined,
		class: className = '',
		columns = false,
		collapsible = false,
		heading = undefined
	}: {
		/** Built server-side from the questions; a deleted or retyped question just drops out. */
		facets: Facet[];
		/** Keyed by `Facet.key`. Bindable. */
		selected?: FacetState;
		/** Fires only on user interaction, like `MultiCombobox.onChange`. */
		onChange?: (selected: FacetState) => void;
		class?: string;
		/** Side by side instead of stacked. */
		columns?: boolean;
		/** Below md, fold behind a toggle. No effect from md up. */
		collapsible?: boolean;
		heading?: string;
	} = $props();

	// Collapsed on phones so a long university list doesn't push results below the fold.
	let expanded = $state(false);

	// Per-facet fold. Absent means collapsed; the badge on a folded facet says it is still engaged.
	let openFacets = $state<Record<string, boolean>>({});

	const uid = $props.id();
	const panelId = (key: string) => `${uid}-${key}`;

	function selectionFor(key: string): FacetSelection {
		return selected[key] ?? {};
	}

	function valuesFor(key: string): string[] {
		return selected[key]?.values ?? [];
	}

	const TYPING_DELAY_MS = 400;
	let typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	function set(key: string, next: FacetSelection) {
		// Otherwise clearing a box mid-debounce fetches twice: once now, once when the timer fires.
		clearTimeout(typingTimers[key]);
		selected = { ...selected, [key]: next };
		onChange?.(selected);
	}

	function setValues(key: string, values: string[]) {
		set(key, { values });
	}

	function toggle(key: string, value: string) {
		const current = valuesFor(key);
		setValues(
			key,
			current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
		);
	}

	// Typed input only. Every caller re-queries from `onChange`, so per-keystroke firing
	// is one `contains` scan per letter.
	function setDebounced(key: string, next: FacetSelection) {
		// The binding updates at once so the input stays responsive; only the notification waits.
		selected = { ...selected, [key]: next };
		clearTimeout(typingTimers[key]);
		typingTimers[key] = setTimeout(() => onChange?.(selected), TYPING_DELAY_MS);
	}

	/** A cleared numeric input is "no bound", not zero. */
	function boundOf(raw: string): number | undefined {
		const trimmed = raw.trim();
		if (!trimmed) return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : undefined;
	}

	// Not `No ${facet.label}`: facets are labelled with the question title, which gave
	// "No how many hackathons have you attended?".
	const NO_VALUE_LABEL = 'No answer';

	// The server ships only the top `MAX_FACET_OPTIONS` of a free-text facet. An absent
	// option must not read as a nonexistent value; search still reaches the rest.
	function truncationHint(facet: Facet): string | undefined {
		if (!facet.truncated) return undefined;
		return `Showing the ${MAX_FACET_OPTIONS} most common — search to find others.`;
	}

	// Every user has a name, so "No full name" would be a filter that returns nothing.
	function hasNoValueRow(facet: Facet): boolean {
		return facet.noneCount > 0;
	}

	function optionsWithNoValue(facet: Facet): MultiComboboxOption[] {
		const options: MultiComboboxOption[] = facet.options.map((option) => ({
			value: option.value,
			label: option.label,
			count: option.count
		}));
		if (hasNoValueRow(facet)) {
			options.push({ value: NO_VALUE, label: NO_VALUE_LABEL, count: facet.noneCount });
		}
		return options;
	}

	// Count of ticked options, or a dot for controls without a count. A folded facet is
	// still narrowing the list and this badge is the only thing that says so.
	function badgeFor(facet: Facet): string | null {
		const selection = selectionFor(facet.key);
		if (selection.values?.length) return String(selection.values.length);
		return isEngaged(selection) ? '•' : null;
	}

	const inputClass =
		'w-full rounded-sm border border-border bg-white px-2 py-1 text-xs text-foreground ' +
		'placeholder:text-foreground-tertiary focus-visible:shadow-ring focus-visible:outline-none';
</script>

<!-- Controls are chosen from `facet.control`, never `facet.key`: nothing here knows
     which question it is rendering, so retyping a question retypes its filter. -->
{#if facets.length > 0}
	<div class={cn('flex flex-col gap-3', className)}>
		{#if collapsible}
			<button
				type="button"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				class="flex w-full cursor-pointer items-center justify-between gap-2 border-none
				       bg-transparent p-0 text-left focus-visible:shadow-ring md:hidden"
			>
				<Eyebrow as="span">{heading ?? 'Application'}</Eyebrow>
				<span class="text-xs text-foreground-secondary">{expanded ? 'Hide' : 'Show'}</span>
			</button>
		{/if}

		{#if heading}
			<Eyebrow class={collapsible ? 'hidden md:block' : ''}>{heading}</Eyebrow>
		{/if}

		<div
			class={cn(
				columns ? 'flex flex-wrap gap-6' : 'flex flex-col gap-5',
				collapsible && !expanded && 'hidden md:flex'
			)}
		>
			{#each facets as facet (facet.key)}
				{@const selection = selectionFor(facet.key)}
				{@const values = valuesFor(facet.key)}
				{@const badge = badgeFor(facet)}
				{@const open = openFacets[facet.key] ?? false}
				<div class={cn('flex flex-col gap-2', columns && 'min-w-0 flex-1 basis-48')}>
					<div class="flex items-baseline justify-between gap-2">
						<button
							type="button"
							onclick={() => (openFacets[facet.key] = !open)}
							aria-expanded={open}
							aria-controls={panelId(facet.key)}
							class="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-none
							       bg-transparent p-0 text-left focus-visible:shadow-ring"
						>
							<span
								aria-hidden="true"
								class="inline-block text-md leading-none text-foreground-tertiary
								       transition-transform duration-150 ease-out-quick {open ? '' : '-rotate-90'}"
							>
								▾
							</span>
							<Eyebrow as="span" class="truncate">{facet.label}</Eyebrow>
							{#if badge}
								<span
									class="rounded-sm bg-primary px-1 font-mono text-2xs leading-normal
									       text-primary-foreground tabular-nums"
								>
									{badge}
								</span>
							{/if}
						</button>
						{#if badge}
							<button
								type="button"
								onclick={() => set(facet.key, {})}
								class="cursor-pointer border-none bg-transparent p-0 text-2xs
								       text-foreground-tertiary underline transition-colors
								       hover:text-foreground focus-visible:shadow-ring"
							>
								Clear
							</button>
						{/if}
					</div>

					{#if !open}
						<!-- Folded. Unmounting loses nothing: `selected` lives with the caller. -->
					{:else if facet.control === 'search'}
						<!-- Free text with no vocabulary worth listing. -->
						<input
							id={panelId(facet.key)}
							type="text"
							class={inputClass}
							aria-label={facet.label}
							placeholder="Contains…"
							value={selection.contains ?? ''}
							oninput={(e) =>
								setDebounced(facet.key, { contains: (e.target as HTMLInputElement).value })}
						/>
					{:else if facet.control === 'range'}
						<!-- Numeric: two bounds, either may be empty. -->
						<div id={panelId(facet.key)} class="flex flex-col gap-1">
							<div class="flex items-center gap-1.5">
								<input
									type="number"
									class={inputClass}
									aria-label="{facet.label} minimum"
									placeholder="Min"
									value={selection.min ?? ''}
									oninput={(e) =>
										setDebounced(facet.key, {
											...selection,
											min: boundOf((e.target as HTMLInputElement).value)
										})}
								/>
								<span class="shrink-0 text-2xs text-foreground-tertiary">to</span>
								<input
									type="number"
									class={inputClass}
									aria-label="{facet.label} maximum"
									placeholder="Max"
									value={selection.max ?? ''}
									oninput={(e) =>
										setDebounced(facet.key, {
											...selection,
											max: boundOf((e.target as HTMLInputElement).value)
										})}
								/>
							</div>
							{#if facet.bounds}
								<span class="text-2xs text-foreground-tertiary">
									Answers range {facet.bounds.min}–{facet.bounds.max}
								</span>
							{/if}
						</div>
					{:else if facet.control === 'combobox'}
						<!-- Free text with an observed vocabulary: no authoritative list, so searchable. -->
						<div id={panelId(facet.key)}>
							<MultiCombobox
								options={optionsWithNoValue(facet)}
								selected={values}
								ariaLabel={facet.label}
								placeholder={`Search ${facet.label.toLowerCase()}…`}
								emptyMessage="No matching {facet.label.toLowerCase()}"
								hint={truncationHint(facet)}
								onChange={(next) => setValues(facet.key, next)}
							/>
						</div>
					{:else}
						<!-- The question enumerates its answers, so the whole vocabulary fits a checkbox list. -->
						{@const chosen = splitNoValue(values)}
						<div id={panelId(facet.key)} class="flex flex-col gap-1.5">
							{#each facet.options as option (option.value)}
								<div class="flex items-center justify-between gap-2">
									<Checkbox
										checked={chosen.values.includes(option.value)}
										label={option.label ?? option.value}
										onCheckedChange={() => toggle(facet.key, option.value)}
									/>
									<span class="shrink-0 font-mono text-2xs text-foreground-tertiary tabular-nums">
										{option.count}
									</span>
								</div>
							{/each}

							{#if hasNoValueRow(facet)}
								<div class="flex items-center justify-between gap-2">
									<Checkbox
										checked={chosen.includeNone}
										label={NO_VALUE_LABEL}
										onCheckedChange={() => toggle(facet.key, NO_VALUE)}
									/>
									<span class="shrink-0 font-mono text-2xs text-foreground-tertiary tabular-nums">
										{facet.noneCount}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
