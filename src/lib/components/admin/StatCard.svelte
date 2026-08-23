<script lang="ts">
	let {
		label,
		value,
		breakdown = undefined
	}: {
		label: string;
		value: number;
		/** Without it the card is inert. */
		breakdown?: Array<{ label: string; value: number }>;
	} = $props();

	// A role nobody holds is not part of the number, so no "Mentors 0" row.
	const rows = $derived(breakdown?.filter((r) => r.value > 0) ?? []);
	const interactive = $derived(rows.length > 0);

	// Screen readers never see the panel, so the figures ride along on the label.
	const ariaSummary = $derived(
		`${label}: ${value.toLocaleString()}. ` + rows.map((r) => `${r.label} ${r.value}`).join(', ')
	);

	let open = $state(false);
	/** Pinned under the card instead of tracking, for focus and touch. */
	let anchored = $state(false);
	let x = $state(0);
	let y = $state(0);
	let panelW = $state(0);
	let panelH = $state(0);

	// Far enough down-right that the pointer never covers the first row.
	const OFFSET = 14;
	const EDGE = 8;

	function place(event: PointerEvent) {
		if (!open || anchored) return;
		// Clamped to the viewport so the last card in a row can't push the panel off screen.
		x = Math.max(EDGE, Math.min(event.clientX + OFFSET, window.innerWidth - panelW - EDGE));
		y = Math.max(EDGE, Math.min(event.clientY + OFFSET, window.innerHeight - panelH - EDGE));
	}

	/** Lets click handling tell a tap from a mouse click. */
	let lastPointer = $state('mouse');

	function enter(event: PointerEvent) {
		if (!interactive) return;
		lastPointer = event.pointerType;
		// Touch and pen have no cursor to follow, so they get the pinned panel.
		anchored = event.pointerType !== 'mouse';
		open = true;
		place(event);
	}

	function down(event: PointerEvent) {
		lastPointer = event.pointerType;
	}

	// Only keyboard focus pins the panel; a click also focuses, and anchoring on that
	// would drop a mouse user out of follow mode mid-hover.
	function focus(event: FocusEvent) {
		if (!interactive) return;
		if (!(event.currentTarget as HTMLElement).matches(':focus-visible')) return;
		anchored = true;
		open = true;
	}

	// Taps and keyboard toggle; a mouse click is ignored because hover already decides.
	function toggle(event: MouseEvent) {
		const keyboard = event.detail === 0;
		if (!keyboard && lastPointer === 'mouse') return;
		anchored = true;
		open = !open;
	}

	function close() {
		open = false;
	}
</script>

{#snippet panel()}
	<!-- pointer-events-none: under the cursor it would steal its own hover and flicker. -->
	<div
		class="pointer-events-none min-w-36 rounded-md border border-border bg-card px-2.5 py-2 shadow-md"
	>
		{#each rows as row (row.label)}
			<div class="flex items-baseline justify-between gap-4 py-0.5">
				<span class="text-2xs text-foreground-secondary">{row.label}</span>
				<span class="font-mono text-2xs text-foreground tabular-nums">
					{row.value.toLocaleString()}
				</span>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet face()}
	<div class="text-[28px] leading-none font-bold text-primary">
		{value.toLocaleString()}
	</div>
	<div class="mt-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
		{label}
	</div>
{/snippet}

{#if interactive}
	<!-- A real <button>: the breakdown is revealed on demand, so its trigger must be
	     focusable and operable. Styled flat so it still reads as a card. -->
	<button
		type="button"
		class="relative block w-full min-w-0 cursor-default rounded-md border border-border bg-white px-5 py-4 text-left outline-none focus-visible:shadow-ring"
		aria-label={ariaSummary}
		aria-expanded={open}
		onpointerenter={enter}
		onpointermove={place}
		onpointerleave={close}
		onpointerdown={down}
		onfocus={focus}
		onblur={close}
		onclick={toggle}
	>
		{@render face()}

		{#if open && anchored}
			<div class="absolute top-full left-0 z-50 mt-1">
				{@render panel()}
			</div>
		{/if}
	</button>
{:else}
	<div class="min-w-0 rounded-md border border-border bg-white px-5 py-4">
		{@render face()}
	</div>
{/if}

{#if open && !anchored}
	<!-- Fixed so the stat grid can't clip it. No transformed ancestor exists on /admin. -->
	<div
		class="fixed z-50"
		style="left: {x}px; top: {y}px"
		bind:clientWidth={panelW}
		bind:clientHeight={panelH}
	>
		{@render panel()}
	</div>
{/if}
