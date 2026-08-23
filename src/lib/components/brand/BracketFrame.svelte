<script lang="ts">
	/**
	 * Four corner brackets, drawn inside a `relative` parent.
	 *
	 * The motif comes off the rail in the brand mock. It is the reason the hacker
	 * portal has square corners everywhere else: a bracket is the corner of a frame,
	 * and it reads as noise next to a radius.
	 *
	 * Used sparingly and on purpose — the rail, and the one card a screen is actually
	 * about. Put it on every card and it stops being a mark and becomes wallpaper.
	 */
	interface Props {
		/** Inset from the parent's edges, plus the stroke color. */
		class?: string;
		/** Arm length. */
		arm?: string;
	}

	let { class: className = 'inset-3 text-brand-ink', arm = 'size-5' }: Props = $props();
</script>

<div class="pointer-events-none absolute {className}" aria-hidden="true">
	<span class="absolute top-0 left-0 {arm} border-t-2 border-l-2 border-current"></span>
	<span class="absolute top-0 right-0 {arm} border-t-2 border-r-2 border-current"></span>
	<span class="absolute bottom-0 left-0 {arm} border-b-2 border-l-2 border-current"></span>
	<span class="absolute right-0 bottom-0 {arm} border-r-2 border-b-2 border-current"></span>
</div>
