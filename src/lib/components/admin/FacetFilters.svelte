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
		/**
		 * One entry per filterable thing an applicant told us — a linked field, any other
		 * question on the form, or the state derived from their university. Built on the
		 * server from the questions themselves, so a question that is deleted, unlinked or
		 * switched to Long Text simply stops appearing here.
		 */
		facets: Facet[];
		/** What each facet's controls hold, keyed by `Facet.key`. Bindable. */
		selected?: FacetState;
		/** Fires only on user interaction — see the note on `MultiCombobox.onChange`. */
		onChange?: (selected: FacetState) => void;
		class?: string;
		/** Lay the facets out side by side instead of stacked, for an inline panel. */
		columns?: boolean;
		/** Below md, collapse the facets behind a toggle. No effect from md up. */
		collapsible?: boolean;
		/** Optional section title above the facets. */
		heading?: string;
	} = $props();

	// Collapsed by default on phones so a long university list doesn't push the
	// results below the fold. md and up ignores this entirely.
	let expanded = $state(false);

	/**
	 * Per-facet fold state, keyed by facet. Absent means open, so every facet is
	 * expanded on arrival at every width — folding a group is something the reader
	 * asks for, never a default that hides a filter they have not seen yet.
	 *
	 * This nests inside `collapsible` above rather than competing with it: that one
	 * folds the whole section on phones, this one folds a single facet anywhere.
	 */
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
		// Cancels a pending keystroke on the same facet. Clearing a substring box while
		// its debounce is still in flight would otherwise fetch twice — once for the
		// clear, once when the stale timer fires against the already-cleared state.
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

	/**
	 * Typing is debounced; ticking is not.
	 *
	 * Every caller re-runs its query from `onChange`, so a substring box firing per
	 * keystroke is one round trip per letter — and each of those is a `contains` scan
	 * over the answer table. A checkbox has no such problem: one click is one intent.
	 */
	function setDebounced(key: string, next: FacetSelection) {
		// The binding updates immediately so the input stays responsive; only the
		// notification waits.
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

	/**
	 * "No answer", not "No <question title>".
	 *
	 * This read `No ${facet.label.toLowerCase()}` back when the only facets were
	 * University and Year, where it produced "No university". A facet is now labelled
	 * with whatever the question is *called*, and questions are commonly phrased as
	 * questions — so the same template produced "No how many hackathons have you
	 * attended?" and "No do you need travel reimbursement?" on the seeded form.
	 *
	 * There is no template that survives arbitrary titles, and the facet's own header
	 * is directly above this row, so the row does not have to repeat it.
	 */
	const NO_VALUE_LABEL = 'No answer';

	/**
	 * What a truncated list has to admit to.
	 *
	 * A free-text facet's vocabulary is unbounded, so the server ships only the most
	 * common `MAX_FACET_OPTIONS` of them. An absent value must not read as a value that
	 * does not exist: the predicate still accepts any value, and searching is how the
	 * rest are reached. Saying nothing here is the one option that misleads.
	 */
	function truncationHint(facet: Facet): string | undefined {
		if (!facet.truncated) return undefined;
		return `Showing the ${MAX_FACET_OPTIONS} most common — search to find others.`;
	}

	/**
	 * Whether "no value" is worth offering at all.
	 *
	 * ~530 users have no university, so that row is a real query. Every user has a
	 * name, so "No full name" would be a filter guaranteed to return nothing — an
	 * option that can only waste a click.
	 */
	function hasNoValueRow(facet: Facet): boolean {
		return facet.noneCount > 0;
	}

	/** The facet's own options plus the "no value" sentinel, in one list. */
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

	/**
	 * The badge on a folded facet's header: how many options are ticked, or a dot for
	 * the controls that have no count to give.
	 *
	 * A facet folded shut is still narrowing the list, and this badge is the only thing
	 * on screen that says so — the same reason the panel count in ApplicantList exists.
	 */
	function badgeFor(facet: Facet): string | null {
		const selection = selectionFor(facet.key);
		if (selection.values?.length) return String(selection.values.length);
		return isEngaged(selection) ? '•' : null;
	}

	const inputClass =
		'w-full rounded-sm border border-border bg-white px-2 py-1 text-xs text-foreground ' +
		'placeholder:text-foreground-tertiary focus-visible:shadow-ring focus-visible:outline-none';
</script>

<!--
	Every control here is chosen from `facet.control`, never from `facet.key`. Switch a
	question from Dropdown to Short Text in the application editor and its filter turns
	from a checkbox list into a substring box on its own, because nothing below knows
	which question it is rendering.
-->
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
				{@const open = openFacets[facet.key] ?? true}
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
						<!-- Folded: header only. The panel below is unmounted, not merely
						     hidden — `selected` lives with the caller, so nothing is lost. -->
					{:else if facet.control === 'search'}
						<!--
							Free text with no vocabulary worth listing. A substring box, because a
							list of what a thousand people typed into "How did you hear about us?"
							is a transcript rather than a filter.
						-->
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
						<!--
							Numeric. Two bounds rather than a value list, because "under 21" is the
							question people ask of a number and no checkbox list expresses it. Either
							end may be left empty, which means unbounded on that side.
						-->
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
								<!-- What the data actually spans, so nobody has to guess the units. -->
								<span class="text-2xs text-foreground-tertiary">
									Answers range {facet.bounds.min}–{facet.bounds.max}
								</span>
							{/if}
						</div>
					{:else if facet.control === 'combobox'}
						<!--
							Free text with a bounded observed vocabulary: there is no authoritative
							list to check off, so the control has to be searchable and typo-tolerant
							to be usable at all.
						-->
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
						<!--
							The question enumerates its own answers, so its option list is
							authoritative and a checkbox list shows the whole vocabulary at once.
						-->
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
