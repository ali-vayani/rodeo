<script lang="ts">
	let {
		label,
		value,
		breakdown = undefined
	}: {
		label: string;
		value: number;
		/** The split behind the number. Without it the card is inert. */
		breakdown?: Array<{ label: string; value: number }>;
	} = $props();

	// Zero rows are dropped rather than shown as "Mentors 0": the panel says what the
	// number is made of, and a role nobody holds is not part of it.
	const rows = $derived(breakdown?.filter((r) => r.value > 0) ?? []);
	const interactive = $derived(rows.length > 0);

	/**
	 * Screen readers never see the panel, so the same figures ride along on the card's
	 * label. Without this the breakdown would be pointer-only information.
	 */
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

	// Down-and-right of the cursor, far enough that the pointer never covers the
	// first row it is pointing at.
	const OFFSET = 14;
	const EDGE = 8;

	function place(event: PointerEvent) {
		if (!open || anchored) return;
		// Flip back inside the viewport near the right and bottom edges, rather than letting
		// the panel run off screen on the last card in the row.
		x = Math.max(EDGE, Math.min(event.clientX + OFFSET, window.innerWidth - panelW - EDGE));
		y = Math.max(EDGE, Math.min(event.clientY + OFFSET, window.innerHeight - panelH - EDGE));
	}

	/** What last touched this card, so click handling can tell a tap from a click. */
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

	/**
	 * Only keyboard focus pins the panel. Clicking a button also focuses it, and
	 * anchoring on that would drop a mouse user out of follow mode mid-hover.
	 */
	function focus(event: FocusEvent) {
		if (!interactive) return;
		if (!(event.currentTarget as HTMLElement).matches(':focus-visible')) return;
		anchored = true;
		open = true;
	}

	/**
	 * Taps and keyboard activation toggle, because neither has a hover to govern the
	 * panel. A mouse click is ignored, since hover already decides what is shown.
	 */
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
	<!-- pointer-events-none so the panel can sit under the cursor without stealing
	     the hover it is reacting to and flickering itself out of existence. -->
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
	<!--
			A real <button>, not a div with a tabindex. The breakdown is revealed on demand, so
			the thing revealing it has to be focusable and operable, which also gives touch a
			tap that works. Styled flat so it still reads as a card.
		-->
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
	<!-- Fixed rather than absolute so the panel is positioned against the viewport and
		     cannot be clipped by the stat grid. No transformed ancestor exists on /admin. -->
	<div
		class="fixed z-50"
		style="left: {x}px; top: {y}px"
		bind:clientWidth={panelW}
		bind:clientHeight={panelH}
	>
		{@render panel()}
	</div>
{/if}
