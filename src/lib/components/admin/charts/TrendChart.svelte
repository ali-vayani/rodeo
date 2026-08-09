<script lang="ts">
	import type { TrendSeries } from '$lib/dashboard';
	import { formatDayLabel } from '$lib/schedule/days';

	/**
	 * Applications and decisions per day.
	 *
	 * **One axis.** Both series are counts of people per day, so they share a
	 * scale and can be compared directly. A second y-axis scaled to each series'
	 * own range would invent a correlation that isn't in the data — it is the
	 * single most misleading thing a chart like this can do.
	 *
	 * Two shades of ink rather than two hues: colour on this dashboard means
	 * decision status, and neither of these series is one. Ink and neutral-400 are
	 * far enough apart in lightness to separate for every reader, and both lines
	 * carry an end-dot plus a legend entry with its current value.
	 */
	/**
	 * `height` is a viewBox height, not pixels — the SVG scales uniformly, so what
	 * this really sets is the aspect ratio. 300 against a 620 width puts the
	 * rendered chart close to the height of the activity feed beside it; at 220 the
	 * card finished a third of the way up its own column and left a hole.
	 */
	let { series, height = 300 }: { series: TrendSeries; height?: number } = $props();

	/**
	 * The viewBox width tracks the rendered width, so one viewBox unit is one CSS
	 * pixel and the chart never scales its own type.
	 *
	 * A fixed 620-unit viewBox looks right at full width and falls apart on a
	 * phone: at 390px the whole drawing is scaled to 0.63, which takes the 10px
	 * axis labels down to about 6px. Measuring the container instead means the
	 * geometry reflows and the text stays the size the design system set it.
	 *
	 * Floored at 320 so a card measured mid-layout (clientWidth 0 on first paint)
	 * never divides by zero or draws a chart narrower than the smallest viewport.
	 */
	let containerWidth = $state(620);
	const W = $derived(Math.max(320, containerWidth));
	const PLOT = $derived({ left: 40, right: W - 24, top: 12, bottom: 0 });

	const points = $derived(series.points);
	const nf = new Intl.NumberFormat('en-US');

	/** Axis ticks land on round numbers, so the gridlines carry readable values. */
	function niceMax(value: number): number {
		if (value <= 4) return 4;
		const magnitude = 10 ** Math.floor(Math.log10(value));
		return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
	}

	const max = $derived(
		niceMax(Math.max(1, ...points.flatMap((p) => [p.applications, p.decisions])))
	);
	const plotBottom = $derived(height - 34); // leaves the x-axis band inside the box
	const ticks = $derived([0, max / 4, max / 2, (max * 3) / 4, max]);

	const x = $derived((i: number) =>
		points.length < 2
			? (PLOT.left + PLOT.right) / 2
			: PLOT.left + i * ((PLOT.right - PLOT.left) / (points.length - 1))
	);
	const y = $derived((value: number) => plotBottom - (value / max) * (plotBottom - PLOT.top));

	const path = $derived((key: 'applications' | 'decisions') =>
		points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')
	);

	const last = $derived(points[points.length - 1]);

	/**
	 * Date labels thinned to whatever the width can hold, at ~90px each.
	 *
	 * A fixed "every nth point" rule fails at one end or the other: six labels fit
	 * comfortably on a full-width card and overlap into a smear on a phone. The
	 * tooltip carries the exact day, so dropping labels costs nothing.
	 */
	const labelEvery = $derived(
		Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 90))))
	);

	let hovered = $state<number | null>(null);
	const hoveredPoint = $derived(hovered === null ? null : (points[hovered] ?? null));

	/**
	 * Nearest-point hover, handled once on the `<svg>` rather than by a transparent
	 * hit rect per day.
	 *
	 * A stack of rects would each need an ARIA role to carry a pointer handler, and
	 * they would be 400 focusable-ish nodes on an all-time window. One handler on
	 * the element that already has `role="img"` reads the pointer's position and
	 * picks the closest column — which also means the whole plot is live, not just
	 * the columns, so there is no dead space between bands.
	 */
	function onPointerMove(event: PointerEvent) {
		const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
		if (box.width === 0 || points.length === 0) return;
		// The viewBox scales uniformly, so a client x maps back through the ratio.
		const viewX = ((event.clientX - box.left) / box.width) * W;
		const span = PLOT.right - PLOT.left;
		const ratio = span === 0 ? 0 : (viewX - PLOT.left) / span;
		const index = Math.round(ratio * (points.length - 1));
		hovered = Math.min(points.length - 1, Math.max(0, index));
	}
</script>

{#if points.length === 0}
	<p class="py-6 text-center text-base text-foreground-secondary">No activity in this range.</p>
{:else}
	<div class="relative" bind:clientWidth={containerWidth}>
		<!-- viewBox width == rendered width (see `containerWidth`), so this neither
		     scales up nor down and `preserveAspectRatio` never comes into it. -->
		<svg
			viewBox="0 0 {W} {height}"
			width="100%"
			role="img"
			aria-label="Applications and decisions per day"
			onpointermove={onPointerMove}
			onpointerleave={() => (hovered = null)}
		>
			{#each ticks as tick (tick)}
				<line
					x1={PLOT.left}
					x2={PLOT.right}
					y1={y(tick)}
					y2={y(tick)}
					class="stroke-border-subtle"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
				<text
					x={PLOT.left - 8}
					y={y(tick) + 3.5}
					text-anchor="end"
					class="fill-foreground-tertiary font-mono text-2xs tabular-nums"
				>
					{nf.format(Math.round(tick))}
				</text>
			{/each}

			<line
				x1={PLOT.left}
				x2={PLOT.right}
				y1={plotBottom}
				y2={plotBottom}
				class="stroke-border"
				stroke-width="1"
				vector-effect="non-scaling-stroke"
			/>

			<path
				d={path('decisions')}
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				class="stroke-neutral-400"
			/>
			<path
				d={path('applications')}
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				class="stroke-primary"
			/>

			<!-- End markers carry a 2px surface ring so they stay legible where the two
			     lines cross. -->
			{#if last}
				<circle
					cx={x(points.length - 1)}
					cy={y(last.decisions)}
					r="4"
					class="fill-neutral-400 stroke-card"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
				<circle
					cx={x(points.length - 1)}
					cy={y(last.applications)}
					r="4"
					class="fill-primary stroke-card"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
			{/if}

			{#each points as point, i (point.day)}
				{#if i % labelEvery === 0 || i === points.length - 1}
					<text
						x={x(i)}
						y={plotBottom + 18}
						text-anchor="middle"
						class="fill-foreground-tertiary font-mono text-2xs"
					>
						{formatDayLabel(point.day)}
					</text>
				{/if}
			{/each}

			{#if hovered !== null}
				<line
					x1={x(hovered)}
					x2={x(hovered)}
					y1={PLOT.top}
					y2={plotBottom}
					class="stroke-border-strong"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
		</svg>

		{#if hoveredPoint && hovered !== null}
			<!-- Follows the crosshair. The viewBox scales uniformly, so a viewBox x maps
			     to a container percentage directly; clamped so the panel can't hang off
			     either edge of the card. -->
			<div
				role="status"
				style="left: {Math.min(88, Math.max(12, (x(hovered) / W) * 100))}%"
				class="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground shadow-lg"
			>
				<div class="font-semibold">{formatDayLabel(hoveredPoint.day)}</div>
				<div class="text-neutral-300">
					Applications <b class="font-semibold text-primary-foreground tabular-nums"
						>{nf.format(hoveredPoint.applications)}</b
					>
				</div>
				<div class="text-neutral-300">
					Decisions <b class="font-semibold text-primary-foreground tabular-nums"
						>{nf.format(hoveredPoint.decisions)}</b
					>
				</div>
			</div>
		{/if}
	</div>

	<ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
		<li class="flex items-center gap-1.5 text-xs text-foreground-secondary">
			<span class="h-0.5 w-3 rounded-sm bg-primary"></span>
			Applications
			<b class="font-semibold text-foreground tabular-nums">{nf.format(last?.applications ?? 0)}</b>
			<span class="font-mono text-2xs text-foreground-tertiary">latest day</span>
		</li>
		<li class="flex items-center gap-1.5 text-xs text-foreground-secondary">
			<span class="h-0.5 w-3 rounded-sm bg-neutral-400"></span>
			Decisions
			<b class="font-semibold text-foreground tabular-nums">{nf.format(last?.decisions ?? 0)}</b>
			<span class="font-mono text-2xs text-foreground-tertiary">latest day</span>
		</li>
	</ul>
{/if}
