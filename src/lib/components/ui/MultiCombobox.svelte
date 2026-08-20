<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { cn } from '$lib/utils';
	import Field from './Field.svelte';
	import { controlBorder } from './controlStyles';
	import { rankOptions } from '$lib/text/fuzzyRank';

	import type { MultiComboboxOption } from './types';

	let {
		options,
		selected = $bindable([]),
		label = undefined,
		hint = undefined,
		error = undefined,
		placeholder = 'Search…',
		emptyMessage = 'No matches',
		required = false,
		disabled = false,
		invalid = false,
		maxVisible = 50,
		class: className = '',
		fieldClass = '',
		ariaLabel = undefined,
		onChange = undefined
	}: {
		options: MultiComboboxOption[];
		/** The chosen values. Bindable, and the component never mutates it in place. */
		selected?: string[];
		label?: string;
		hint?: string;
		error?: string | null;
		placeholder?: string;
		/** Shown in the listbox when the query matches nothing, fuzzily or otherwise. */
		emptyMessage?: string;
		required?: boolean;
		disabled?: boolean;
		/** Standalone invalid state, for use without a Field. */
		invalid?: boolean;
		/**
		 * Cap on rendered rows. Every option is still ranked; this only limits how many
		 * become DOM. The remainder is counted in a trailing row.
		 */
		maxVisible?: number;
		class?: string;
		fieldClass?: string;
		/** For a combobox with no visible label — a filter rail, a toolbar. */
		ariaLabel?: string;
		/**
		 * Fires only on user selection, unlike an `$effect` on `selected`, which also runs
		 * when the parent resets the binding and would turn that into a second round-trip.
		 */
		onChange?: (selected: string[]) => void;
	} = $props();

	const uid = $props.id();

	let query = $state('');
	let open = $state(false);
	let shellEl = $state<HTMLElement | null>(null);

	/**
	 * Which row Enter would take, and the only row drawn as active.
	 *
	 * bits-ui tracks its own highlight, but moves it before a keystroke re-renders the
	 * filtered list, so straight after typing it points at whatever was first a moment
	 * ago. Derived here from one rule instead: until the user moves it with the keyboard,
	 * the active row is the top-ranked match. `data-highlighted` is deliberately unstyled.
	 */
	let highlighted = $state<string | null>(null);
	let navigated = $state(false);

	const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];

	const labelFor = $derived(
		new Map(options.map((option) => [option.value, option.label ?? option.value]))
	);

	// Stable per option, so `aria-activedescendant` can point at a row this component
	// names rather than at whichever id bits-ui last happened to highlight.
	const idFor = $derived(
		new Map(options.map((option, index) => [option.value, `${uid}-o${index}`]))
	);

	const ranked = $derived(rankOptions(options, query));
	const visible = $derived(ranked.slice(0, maxVisible));
	const hidden = $derived(ranked.length - visible.length);

	const activeValue = $derived(
		navigated && highlighted !== null && visible.some((option) => option.value === highlighted)
			? highlighted
			: (visible[0]?.value ?? null)
	);

	function display(value: string): string {
		return labelFor.get(value) ?? value;
	}

	function toggle(value: string) {
		const next = selected.includes(value)
			? selected.filter((item) => item !== value)
			: [...selected, value];
		selected = next;
		onChange?.(next);
	}

	function onInput(event: Event) {
		query = (event.currentTarget as HTMLInputElement).value;
		navigated = false;
	}

	/**
	 * bits-ui opens the listbox on the trigger and on the first keystroke, but not on the
	 * input itself, which is correct for a single-select and wrong here. This is a filter,
	 * and clicking the box you are about to type in is how you ask to see the vocabulary.
	 */
	function onClick() {
		if (!disabled) open = true;
	}

	// Runs before bits-ui's own handler, since svelte-toolbelt composes in prop order and
	// stops at the first `preventDefault`. That is what lets these keys mean something
	// different here than in a single-select combobox.
	function onKeydown(event: KeyboardEvent) {
		if (NAVIGATION_KEYS.includes(event.key)) {
			navigated = true;
			return;
		}

		if (event.key === 'Backspace' && query === '' && selected.length > 0) {
			event.preventDefault();
			toggle(selected[selected.length - 1]);
			return;
		}

		if (event.key === 'Enter' && open && activeValue !== null) {
			event.preventDefault();
			toggle(activeValue);
		}
	}
</script>

{#snippet control(id: string | undefined, isInvalid: boolean, describedBy: string | undefined)}
	<Combobox.Root
		type="multiple"
		bind:value={selected}
		bind:open
		{disabled}
		onValueChange={(value) => onChange?.(value)}
	>
		<!--
					The whole shell is the anchor, not the input. The input is one flex child among
					the chips and is often a few characters wide, and a popover that narrow is
					unreadable.
				-->
		<div
			bind:this={shellEl}
			class={cn(
				'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md bg-card px-1.5 py-1',
				'text-touch text-foreground transition-[border-color,box-shadow] duration-150 sm:text-base',
				'focus-within:border-primary focus-within:shadow-ring',
				controlBorder(isInvalid),
				isInvalid && 'focus-within:shadow-ring-danger',
				disabled && 'cursor-not-allowed bg-muted text-faint',
				className
			)}
		>
			{#each selected as value (value)}
				<!--
									No `Badge` here: a badge is the eyebrow tier (mono, uppercase, 10px), which is
									right for a status and wrong for a proper noun. A chip holding a university
									name is body text that happens to sit in a box.
								-->
				<span
					class="inline-flex max-w-full items-center gap-1 rounded-sm border border-border
					       bg-muted pr-0.5 pl-1.5 text-sm text-foreground"
				>
					<span class="truncate">{display(value)}</span>
					<button
						type="button"
						{disabled}
						aria-label={`Remove ${display(value)}`}
						onclick={() => toggle(value)}
						class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm
						       border-none bg-transparent p-0 text-2xs leading-none text-foreground-tertiary
						       transition-colors duration-150 hover:bg-neutral-200 hover:text-foreground
						       focus-visible:shadow-ring disabled:cursor-not-allowed"
					>
						✕
					</button>
				</span>
			{/each}

			<Combobox.Input
				oninput={onInput}
				onkeydown={onKeydown}
				onclick={onClick}
				aria-label={ariaLabel}
				aria-invalid={isInvalid || undefined}
				aria-describedby={describedBy}
				{placeholder}
				{required}
			>
				{#snippet child({ props })}
					<input
						{...props}
						{id}
						value={query}
						aria-activedescendant={activeValue !== null ? idFor.get(activeValue) : undefined}
						class="min-w-16 flex-1 border-none bg-transparent px-1 text-touch
						       text-foreground outline-none placeholder:text-faint disabled:cursor-not-allowed
						       sm:text-base"
					/>
				{/snippet}
			</Combobox.Input>

			<Combobox.Trigger
				aria-label={label ? `Show ${label} options` : 'Show options'}
				class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm
				       border-none bg-transparent p-0 text-2xs text-foreground-tertiary
				       focus-visible:shadow-ring disabled:cursor-not-allowed"
			>
				▾
			</Combobox.Trigger>
		</div>

		<Combobox.Portal>
			<!--
							Sized to its content, floored at the input's width and capped at what the
							viewport leaves. Locked to the anchor width, a narrow filter rail truncated every
							option and made the three UT campuses indistinguishable.
						-->
			<Combobox.Content
				customAnchor={shellEl}
				sideOffset={4}
				class="z-50 max-h-64 w-max max-w-[var(--bits-floating-available-width)]
				       min-w-[var(--bits-combobox-anchor-width)] overflow-y-auto rounded-lg
				       border border-border bg-card p-1 shadow-md"
			>
				<Combobox.Viewport>
					{#each visible as option (option.value)}
						{@const text = option.label ?? option.value}
						<Combobox.Item
							id={idFor.get(option.value)}
							value={option.value}
							label={text}
							disabled={option.disabled}
							onHighlight={() => (highlighted = option.value)}
							class={cn(
								'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5',
								'text-base text-foreground outline-none select-none hover:bg-muted',
								'data-disabled:pointer-events-none data-disabled:opacity-50',
								activeValue === option.value && 'bg-muted'
							)}
						>
							{#snippet children({ selected: isSelected })}
								<span class="flex min-w-0 items-center gap-1.5">
									<span class="w-3 shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true"
										>{isSelected ? '✓' : ''}</span
									>
									<span class="truncate">{text}</span>
								</span>
								{#if option.count !== undefined}
									<!--
																		Right-aligned and de-emphasised, but never omitted: the count is how an
																		organizer notices that two spellings of one university are two real
																		populations.
																	-->
									<span class="shrink-0 font-mono text-2xs text-foreground-tertiary tabular-nums">
										{option.count}
									</span>
								{/if}
							{/snippet}
						</Combobox.Item>
					{:else}
						<div class="px-2 py-1.5 text-base text-foreground-tertiary">{emptyMessage}</div>
					{/each}

					{#if hidden > 0}
						<!--
													Not a `Combobox.Item`: it is a fact about the list, not a row in it, so it
													must not be reachable with the arrow keys. Saying how many were dropped is
													what stops a capped list from reading as the whole vocabulary.
												-->
						<div class="border-t border-border-subtle px-2 py-1.5 text-xs text-foreground-tertiary">
							{hidden} more — keep typing to narrow
						</div>
					{/if}
				</Combobox.Viewport>
			</Combobox.Content>
		</Combobox.Portal>
	</Combobox.Root>
{/snippet}

{#if label !== undefined || hint !== undefined || error !== undefined}
	<Field {label} {hint} {error} {required} class={fieldClass}>
		{#snippet children({ id, invalid: fieldInvalid, describedBy })}
			{@render control(id, fieldInvalid, describedBy)}
		{/snippet}
	</Field>
{:else}
	{@render control(undefined, invalid, undefined)}
{/if}
