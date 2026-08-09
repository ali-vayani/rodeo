/**
 * The one place decisions get a colour, and the reasoning for it.
 *
 * Rodeo is monochrome: colour carries exactly one meaning, status. A decision is
 * a status, so the decision buckets are the only coloured series on the
 * dashboard and everything else — universities, per-day volume, the funnel — is
 * ink. That is a constraint, not a limitation: it means a splash of green on the
 * page always means the same thing.
 *
 * ## Validated, not eyeballed
 *
 * Run against the `#ffffff` card surface (dataviz validator, categorical mode):
 *
 *     [PASS] Lightness band        all inside L 0.43–0.77
 *     [PASS] Chroma floor
 *     [PASS] Normal-vision floor   worst adjacent 16.0 (Rejected↔Waitlisted)
 *     [WARN] CVD separation        worst adjacent 6.5 protan (Waitlisted↔Accepted)
 *     [WARN] Contrast vs surface   Accepted 2.76, Waitlisted 2.35
 *
 * Both warnings carry obligations, and every chart in this directory meets them:
 *
 *   - A CVD ΔE in the 6–8 band is legal **only with secondary encoding**. So
 *     stacked segments are separated by a 2px surface gap and every segment's
 *     value is also written out as a number. Nothing here is readable by hue
 *     alone.
 *   - Sub-3:1 contrast obliges visible labels or a table view. `DecisionBar`
 *     ships both.
 *
 * The darker 700-step ramp was tried first and **rejected**: Rejected↔Waitlisted
 * measures ΔE 3.9 (deutan) and 6.1 with normal vision, i.e. hard to tell apart
 * even for readers with full colour vision. Brighter-and-labelled beats
 * darker-and-indistinguishable.
 *
 * `awaiting` is the de-emphasis gray rather than a fourth hue. It is the absence
 * of a decision, and giving it a colour would make "nobody has looked at this
 * yet" compete for attention with the outcomes.
 */

export type DecisionKey = 'accepted' | 'waitlisted' | 'rejected' | 'awaiting';

export interface DecisionSeries {
	key: DecisionKey;
	label: string;
	/** Written out, never built as `bg-${key}-500` — Tailwind scans source statically. */
	fill: string;
	dot: string;
	/** Ink for a label sitting *inside* the fill, picked by the fill's luminance. */
	inlineText: string;
	hint: string;
}

/**
 * Order is the funnel's order — accepted, waitlisted, rejected, then the
 * undecided tail — not a colour-safety ordering. The adjacent pair that scores
 * worst (waitlisted↔accepted, 6.5) is adjacent in *either* arrangement, so
 * reordering buys nothing and costs the reader a sequence they already expect.
 */
export const DECISION_SERIES: readonly DecisionSeries[] = [
	{
		key: 'accepted',
		label: 'Accepted',
		fill: 'bg-success-500',
		dot: 'bg-success-500',
		inlineText: 'text-primary-foreground',
		hint: 'Decision released and emailed.'
	},
	{
		key: 'waitlisted',
		label: 'Waitlisted',
		fill: 'bg-warning-500',
		dot: 'bg-warning-500',
		inlineText: 'text-primary-foreground',
		hint: 'Held for a spot that may open up.'
	},
	{
		key: 'rejected',
		label: 'Rejected',
		fill: 'bg-danger-500',
		dot: 'bg-danger-500',
		inlineText: 'text-primary-foreground',
		hint: 'Decision released and emailed.'
	},
	{
		key: 'awaiting',
		label: 'Awaiting',
		// neutral-400: light enough that ink, not white, is the legible label on it.
		fill: 'bg-neutral-400',
		dot: 'bg-neutral-400',
		inlineText: 'text-foreground',
		hint: 'No released decision yet.'
	}
] as const;
