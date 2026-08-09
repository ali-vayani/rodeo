<script lang="ts">
	import { cn } from '$lib/utils';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Eyebrow from '$lib/components/ui/Eyebrow.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import {
		MAX_FACET_OPTIONS,
		NO_VALUE,
		splitNoValue,
		type LinkedFacet,
		type LinkedUserField
	} from '$lib/linkedFields';
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
		 * One entry per application question that writes through to a `User` column.
		 * Built on the server from the questions themselves, so a question that stops
		 * being linked simply stops appearing here.
		 */
		facets: LinkedFacet[];
		/** Chosen values per field, `NO_VALUE` included. Bindable. */
		selected?: Partial<Record<LinkedUserField, string[]>>;
		/** Fires only on user interaction — see the note on `MultiCombobox.onChange`. */
		onChange?: (selected: Partial<Record<LinkedUserField, string[]>>) => void;
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
	 * Per-facet fold state, keyed by field. Absent means open, so every facet is
	 * expanded on arrival at every width — folding a group is something the reader
	 * asks for, never a default that hides a filter they have not seen yet.
	 *
	 * This nests inside `collapsible` above rather than competing with it: that one
	 * folds the whole section on phones, this one folds a single facet anywhere.
	 */
	let openFacets = $state<Partial<Record<LinkedUserField, boolean>>>({});

	const uid = $props.id();
	const panelId = (field: LinkedUserField) => `${uid}-${field}`;

	function valuesFor(field: LinkedUserField): string[] {
		return selected[field] ?? [];
	}

	function set(field: LinkedUserField, values: string[]) {
		selected = { ...selected, [field]: values };
		onChange?.(selected);
	}

	function toggle(field: LinkedUserField, value: string) {
		const current = valuesFor(field);
		set(
			field,
			current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
		);
	}

	/**
	 * "No university", not "None".
	 *
	 * The row is labelled from the question's own title so it still reads correctly
	 * when an organizer renames the question — which is the same reason the control
	 * below is chosen from `facet.control` and not from the field name.
	 */
	function noValueLabel(facet: LinkedFacet): string {
		return `No ${facet.label.toLowerCase()}`;
	}

	/**
	 * What a truncated list has to admit to.
	 *
	 * The Full Name facet is one option per person, so the server ships only the most
	 * common `MAX_FACET_OPTIONS` of them. An absent name must not read as a name that
	 * does not exist: the predicate still accepts any value, and searching is how the
	 * rest are reached. Saying nothing here is the one option that misleads.
	 */
	function truncationHint(facet: LinkedFacet): string | undefined {
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
	function hasNoValueRow(facet: LinkedFacet): boolean {
		return facet.noneCount > 0;
	}

	/** The facet's own options plus the "no value" sentinel, in one list. */
	function optionsWithNoValue(facet: LinkedFacet): MultiComboboxOption[] {
		const options: MultiComboboxOption[] = facet.options.map((option) => ({
			value: option.value,
			count: option.count
		}));
		if (hasNoValueRow(facet)) {
			options.push({ value: NO_VALUE, label: noValueLabel(facet), count: facet.noneCount });
		}
		return options;
	}
</script>

<!--
	Every control here is chosen from `facet.control`, never from `facet.field`.
	Switch the Year question from Dropdown to Short Text in the application editor
	and its filter turns from a checkbox list into a type-ahead on its own, because
	nothing below knows that a field called `year` exists.
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
			{#each facets as facet (facet.field)}
				{@const values = valuesFor(facet.field)}
				{@const open = openFacets[facet.field] ?? true}
				<div class={cn('flex flex-col gap-2', columns && 'min-w-0 flex-1 basis-48')}>
					<div class="flex items-baseline justify-between gap-2">
						<button
							type="button"
							onclick={() => (openFacets[facet.field] = !open)}
							aria-expanded={open}
							aria-controls={panelId(facet.field)}
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
							<!--
								A facet folded shut is still narrowing the list, and this badge is
								the only thing on screen that says so — the same reason the panel
								count in ApplicantList exists.
							-->
							{#if values.length > 0}
								<span
									class="rounded-sm bg-primary px-1 font-mono text-2xs leading-normal
									       text-primary-foreground tabular-nums"
								>
									{values.length}
								</span>
							{/if}
						</button>
						{#if values.length > 0}
							<button
								type="button"
								onclick={() => set(facet.field, [])}
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
					{:else if facet.control === 'combobox'}
						<!--
							Free text: the vocabulary is whatever applicants typed, so there is no
							authoritative list to check off and the control has to be searchable
							and typo-tolerant to be usable at all.
						-->
						<div id={panelId(facet.field)}>
							<MultiCombobox
								options={optionsWithNoValue(facet)}
								selected={values}
								ariaLabel={facet.label}
								placeholder={`Search ${facet.label.toLowerCase()}…`}
								emptyMessage="No matching {facet.label.toLowerCase()}"
								hint={truncationHint(facet)}
								onChange={(next) => set(facet.field, next)}
							/>
						</div>
					{:else}
						<!--
							The question enumerates its own answers, so `Question.options` is
							authoritative and a checkbox list shows the whole vocabulary at once.
						-->
						{@const chosen = splitNoValue(values)}
						<div id={panelId(facet.field)} class="flex flex-col gap-1.5">
							{#each facet.options as option (option.value)}
								<div class="flex items-center justify-between gap-2">
									<Checkbox
										checked={chosen.values.includes(option.value)}
										label={option.value}
										onCheckedChange={() => toggle(facet.field, option.value)}
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
										label={noValueLabel(facet)}
										onCheckedChange={() => toggle(facet.field, NO_VALUE)}
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
