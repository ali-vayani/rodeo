<script lang="ts">
	import type { TrendSeries } from '$lib/dashboard';
	import { formatDayLabel } from '$lib/schedule/days';

	// One shared axis: both series are people per day, and a second y-axis would invent a
	// correlation. Two shades of ink, not two hues, since colour here means decision status.
	// `height` is viewBox units, so it really sets the aspect ratio.
	let { series, height = 300 }: { series: TrendSeries; height?: number } = $props();

	// viewBox width tracks rendered width so one unit is one CSS px and text never
	// scales: a fixed 620 viewBox took 10px labels to ~6px on a phone. Floored at 320 so
	// a card measured mid-layout never divides by zero.
	let containerWidth = $state(620);
	const W = $derived(Math.max(320, containerWidth));
	const PLOT = $derived({ left: 40, right: W - 24, top: 12, bottom: 0 });

	const points = $derived(series.points);
	const nf = new Intl.NumberFormat('en-US');

	/** Rounds up so the axis ticks land on readable values. */
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

	// Date labels thinned to what the width holds at ~90px each; the tooltip has the exact day.
	const labelEvery = $derived(
		Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 90))))
	);

	let hovered = $state<number | null>(null);
	const hoveredPoint = $derived(hovered === null ? null : (points[hovered] ?? null));

	// One handler on the <svg> rather than a hit rect per day: the rects would each need
	// an ARIA role and total 400 nodes on an all-time window.
	function onPointerMove(event: PointerEvent) {
		const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
		if (box.width === 0 || points.length === 0) return;
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

			<!-- 2px surface ring keeps the end markers legible where the lines cross. -->
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
			<!-- viewBox x maps straight to a container percentage; clamped so the panel
			     can't hang off either edge. -->
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
