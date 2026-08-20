<script lang="ts">
	import { untrack } from 'svelte';
	import { Combobox as Bits } from 'bits-ui';
	import { cn } from '$lib/utils';
	import Field from './Field.svelte';
	import { controlBorder } from './controlStyles';
	import { rankOptions } from '$lib/text/fuzzyRank';

	import type { ComboboxOption } from './types';

	let {
		options,
		value = $bindable(''),
		label = undefined,
		hint = undefined,
		error = undefined,
		placeholder = 'Search…',
		emptyMessage = 'No matches',
		required = false,
		disabled = false,
		invalid = false,
		maxVisible = 50,
		allowCustom = false,
		customLabel = 'Not listed — enter it myself',
		mono = false,
		clearable = false,
		id = undefined,
		class: className = '',
		fieldClass = '',
		ariaLabel = undefined,
		onChange = undefined
	}: {
		options: ComboboxOption[];
		/** The chosen value. May be an option's value or, with `allowCustom`, free text. */
		value?: string;
		label?: string;
		hint?: string;
		error?: string | null;
		placeholder?: string;
		emptyMessage?: string;
		required?: boolean;
		disabled?: boolean;
		/** Standalone invalid state, for use without a Field. */
		invalid?: boolean;
		/**
		 * Cap on rendered rows. Every option is still ranked; this limits how many become
		 * DOM, and the remainder is counted in a trailing row.
		 */
		maxVisible?: number;
		/**
		 * Offer a row that swaps the list for a plain text box.
		 *
		 * For a list that is long but not exhaustive. The university preset is 6,447
		 * institutions and still misses schools.
		 */
		allowCustom?: boolean;
		customLabel?: string;
		/** Tabular content — ids, timestamps. Inherited from the `Select` this replaced. */
		mono?: boolean;
		/**
		 * Offer an "everything" row that sets the value back to `''`.
		 *
		 * Filter bars need it. A `Select` showed its placeholder as an unselectable first
		 * row, so "All admins" was reachable only by reloading.
		 */
		clearable?: boolean;
		/**
		 * Id for the input, so an external `<label for>` reaches it.
		 *
		 * Ignored when `label` is set, since `Field` generates and wires one itself.
		 */
		id?: string;
		class?: string;
		fieldClass?: string;
		/** For a combobox with no visible label. */
		ariaLabel?: string;
		/** Fires only on user selection, not when the parent resets the binding. */
		onChange?: (value: string) => void;
	} = $props();

	const uid = $props.id();

	/** The row that swaps the list for a text box. Never a real option's value. */
	const WRITE_IN = '__WRITE_IN__';

	let query = $state('');
	let open = $state(false);
	let shellEl = $state<HTMLElement | null>(null);
	let customEl = $state<HTMLInputElement | null>(null);

	const labelFor = $derived(
		new Map(options.map((option) => [option.value, option.label ?? option.value]))
	);

	const idFor = $derived(
		new Map(options.map((option, index) => [option.value, `${uid}-o${index}`]))
	);

	/**
	 * Whether the control is currently a text box rather than a list.
	 *
	 * Initialised from the value it was handed, so a saved write-in reopens as a write-in.
	 * `untrack` states the intent: this is a starting position, not a derivation. As a
	 * `$derived` it would drag the control back to the list on the first keystroke.
	 */
	let custom = $state(
		untrack(() => allowCustom && value !== '' && !options.some((o) => o.value === value))
	);

	/**
	 * Which row Enter would take, as an index into `selectable`.
	 *
	 * Owned here rather than read back from bits-ui's highlight, which walks its own list
	 * and knows nothing about the ranking. On a query of "s", ranked `Sophomore, Senior,
	 * Freshman`, one ArrowDown landed on Freshman and Enter committed it.
	 */
	let activeIndex = $state(0);

	const ranked = $derived(rankOptions(options, query));
	const visible = $derived(ranked.slice(0, maxVisible));
	const hidden = $derived(ranked.length - visible.length);

	/** The "everything" row is only offered on an unfiltered list — it is not a match. */
	const showClear = $derived(clearable && query === '');

	/** Every row Enter or the arrow keys can land on, in the order they render. */
	const selectable = $derived([
		...(showClear ? [''] : []),
		...visible.map((o) => o.value),
		...(allowCustom ? [WRITE_IN] : [])
	]);

	/** Clamped, because the list shrinks under the cursor as the query narrows it. */
	const activeValue = $derived(selectable[Math.min(activeIndex, selectable.length - 1)] ?? null);

	/**
	 * Keep the active row on screen.
	 *
	 * bits-ui scrolled its own highlight into view; now that the highlight is ours, so is
	 * the scrolling. Without it, arrowing down a 6,447-row list moves nothing visible.
	 */
	$effect(() => {
		if (!open || activeValue === null) return;
		const id = activeValue === WRITE_IN || activeValue === '' ? null : idFor.get(activeValue);
		if (!id) return;
		document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
	});

	function display(candidate: string): string {
		return labelFor.get(candidate) ?? candidate;
	}

	/**
	 * The typed query while the list is open, the chosen option's label once it is shut.
	 * Without the second half the box empties itself the moment it loses focus.
	 */
	const inputText = $derived(open ? query : value === '' ? '' : display(value));

	function commit(next: string) {
		value = next;
		onChange?.(next);
	}

	function select(candidate: string) {
		if (candidate === WRITE_IN) {
			custom = true;
			open = false;
			query = '';
			// Start the box empty. Carrying the previous pick over meant the first keystroke
			// appended to it, and choosing "Not listed" is precisely the act of saying the
			// previous pick was wrong.
			commit('');
			// The point of the row is to type in the box it reveals.
			queueMicrotask(() => customEl?.focus());
			return;
		}
		commit(candidate);
		open = false;
		query = '';
	}

	function onInput(event: Event) {
		query = (event.currentTarget as HTMLInputElement).value;
		// Back to the top-ranked match: a new query is a new list, and holding position
		// in it would leave the cursor on a row the typist never looked at.
		activeIndex = 0;
		open = true;
	}

	function onClick() {
		if (disabled) return;
		open = true;
		activeIndex = 0;
	}

	/**
	 * Arrow keys, Home/End and Enter, all handled here and none passed on.
	 *
	 * This runs before bits-ui's own handler, since svelte-toolbelt composes in prop order
	 * and stops at the first `preventDefault`. That is what keeps bits-ui's highlight from
	 * moving independently of the row drawn as active.
	 */
	function onKeydown(event: KeyboardEvent) {
		const last = selectable.length - 1;
		if (last < 0) return;

		const move: Record<string, number> = {
			ArrowDown: Math.min(activeIndex + 1, last),
			ArrowUp: Math.max(activeIndex - 1, 0),
			Home: 0,
			End: last,
			PageDown: Math.min(activeIndex + 10, last),
			PageUp: Math.max(activeIndex - 10, 0)
		};

		if (event.key in move) {
			event.preventDefault();
			open = true;
			activeIndex = move[event.key];
			return;
		}

		if (event.key === 'Enter' && open && activeValue !== null) {
			event.preventDefault();
			select(activeValue);
		}
	}

	/** Back to the list, discarding the write-in — otherwise it would survive as a value. */
	function leaveCustom() {
		custom = false;
		commit('');
		query = '';
	}
</script>

{#snippet control(id: string | undefined, isInvalid: boolean, describedBy: string | undefined)}
	{#if custom}
		<div class="flex w-full items-center gap-1.5">
			<input
				bind:this={customEl}
				{id}
				type="text"
				{disabled}
				{required}
				{placeholder}
				aria-label={ariaLabel}
				aria-invalid={isInvalid || undefined}
				aria-describedby={describedBy}
				value={value === WRITE_IN ? '' : value}
				oninput={(event) => commit((event.currentTarget as HTMLInputElement).value)}
				class={cn(
					'min-h-8 w-full rounded-md bg-card px-2 py-1 text-touch text-foreground',
					'transition-[border-color,box-shadow] duration-150 outline-none sm:text-base',
					'placeholder:text-faint focus:border-primary focus:shadow-ring',
					controlBorder(isInvalid),
					isInvalid && 'focus:shadow-ring-danger',
					disabled && 'cursor-not-allowed bg-muted text-faint',
					className
				)}
			/>
			<button
				type="button"
				{disabled}
				onclick={leaveCustom}
				class="shrink-0 cursor-pointer rounded-sm border border-border bg-card px-1.5 py-0.5
				       text-xs text-foreground-secondary transition-colors duration-150
				       hover:bg-surface-hover focus-visible:shadow-ring disabled:cursor-not-allowed"
			>
				Search instead
			</button>
		</div>
	{:else}
		<!--
					Selection goes through bits-ui's own `value`/`onValueChange`, not a click handler
					on each row. bits-ui closes the popover on `pointerup`, which unmounts the row
					before `click` can fire, so the handler never ran while bits-ui's internal
					selection did. It took a second click to catch up, one row behind forever.

					Controlled rather than `bind:value`: choosing "Not listed" momentarily makes the
					sentinel the selected value, and a binding would write that out to the caller.

					`allowDeselect={false}` because bits-ui otherwise treats a click on the current
					row as "unselect", which on a required question silently blanks an answer the
					applicant was only re-confirming. Clearing is the `clearable` row's job.
				-->
		<Bits.Root
			type="single"
			value={value === WRITE_IN ? '' : value}
			onValueChange={select}
			allowDeselect={false}
			{disabled}
			bind:open
		>
			<!-- The shell is the anchor rather than the input, so the popover is measured
						     against the control an organizer sees rather than a bare text field. -->
			<div
				bind:this={shellEl}
				class={cn(
					'flex min-h-8 w-full cursor-text items-center gap-1 rounded-md bg-card px-1.5 py-1',
					'text-touch text-foreground transition-[border-color,box-shadow] duration-150 sm:text-base',
					'focus-within:border-primary focus-within:shadow-ring',
					controlBorder(isInvalid),
					isInvalid && 'focus-within:shadow-ring-danger',
					disabled && 'cursor-not-allowed bg-muted text-faint',
					className
				)}
			>
				<Bits.Input
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
							value={inputText}
							aria-activedescendant={activeValue !== null && activeValue !== WRITE_IN
								? idFor.get(activeValue)
								: undefined}
							class={cn(
								`min-w-16 flex-1 border-none bg-transparent px-1 text-touch text-foreground
								 outline-none placeholder:text-faint disabled:cursor-not-allowed sm:text-base`,
								mono && 'font-mono'
							)}
						/>
					{/snippet}
				</Bits.Input>

				<Bits.Trigger
					aria-label={label ? `Show ${label} options` : 'Show options'}
					class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm
					       border-none bg-transparent p-0 text-2xs text-foreground-tertiary
					       focus-visible:shadow-ring disabled:cursor-not-allowed"
				>
					▾
				</Bits.Trigger>
			</div>

			<Bits.Portal>
				<!--
									Sized to its content, floored at the control's width and capped at what the
									viewport leaves. Locked to the anchor width, the three UT campuses all
									truncated to "The University of Tex..." and became indistinguishable.
								-->
				<Bits.Content
					customAnchor={shellEl}
					sideOffset={4}
					class="z-50 max-h-64 w-max max-w-[var(--bits-floating-available-width)]
					       min-w-[var(--bits-combobox-anchor-width)] overflow-y-auto rounded-lg
					       border border-border bg-card p-1 shadow-md"
				>
					<Bits.Viewport>
						{#if showClear}
							<!-- "All admins" / "All actions": the row that clears the filter. Only on an
														     unfiltered list, because it is not a match for anything anyone typed. -->
							<Bits.Item
								value=""
								label={placeholder}
								class={cn(
									'flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5',
									'text-base text-foreground-secondary outline-none select-none hover:bg-muted',
									activeValue === '' && 'bg-muted'
								)}
							>
								<span class="w-3 shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true">
									{value === '' ? '✓' : ''}
								</span>
								<span class="truncate">{placeholder}</span>
							</Bits.Item>
						{/if}

						{#each visible as option (option.value)}
							{@const text = option.label ?? option.value}
							<Bits.Item
								id={idFor.get(option.value)}
								value={option.value}
								label={text}
								disabled={option.disabled}
								class={cn(
									'flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5',
									'text-base text-foreground outline-none select-none hover:bg-muted',
									'data-disabled:pointer-events-none data-disabled:opacity-50',
									activeValue === option.value && 'bg-muted'
								)}
							>
								<span class="w-3 shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true">
									{value === option.value ? '✓' : ''}
								</span>
								<span class="truncate">{text}</span>
							</Bits.Item>
						{:else}
							{#if !allowCustom}
								<div class="px-2 py-1.5 text-base text-foreground-tertiary">{emptyMessage}</div>
							{/if}
						{/each}

						{#if allowCustom}
							<!--
															Always offered, not only when the search comes up empty. Someone whose
															school is missing usually finds a near-miss rather than nothing.
														-->
							<Bits.Item
								value={WRITE_IN}
								label={customLabel}
								class={cn(
									'mt-1 flex cursor-pointer items-center gap-1.5 rounded-sm border-t',
									'border-border-subtle px-2 py-1.5 text-base text-foreground-secondary',
									'outline-none select-none hover:bg-muted',
									activeValue === WRITE_IN && 'bg-muted'
								)}
							>
								<span class="w-3 shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true">
									＋
								</span>
								<span class="truncate">{customLabel}</span>
							</Bits.Item>
						{/if}

						{#if hidden > 0}
							<!--
															A fact about the list, not a row in it, so not a `Bits.Item` and not
															reachable with the arrow keys. Stops a capped list reading as the whole
															vocabulary.
														-->
							<div
								class="border-t border-border-subtle px-2 py-1.5 text-xs text-foreground-tertiary"
							>
								{hidden} more — keep typing to narrow
							</div>
						{/if}
					</Bits.Viewport>
				</Bits.Content>
			</Bits.Portal>
		</Bits.Root>
	{/if}
{/snippet}

{#if label !== undefined || hint !== undefined || error !== undefined}
	<Field {label} {hint} {error} {required} class={fieldClass}>
		{#snippet children({ id, invalid: fieldInvalid, describedBy })}
			{@render control(id, fieldInvalid, describedBy)}
		{/snippet}
	</Field>
{:else}
	{@render control(id, invalid, undefined)}
{/if}
