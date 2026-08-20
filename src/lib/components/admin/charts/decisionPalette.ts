/**
 * The one place decisions get a colour.
 *
 * Rodeo is monochrome: colour carries exactly one meaning, status. Decisions are the
 * only coloured series on the dashboard and everything else is ink.
 *
 * Validated against the `#ffffff` card surface rather than eyeballed. Two warnings
 * carry obligations that every chart here meets: a CVD delta-E in the 6-8 band is legal
 * only with secondary encoding, so segments are separated by a 2px surface gap and
 * every value is written out as a number; sub-3:1 contrast obliges visible labels or a
 * table view, and `DecisionBar` ships both.
 *
 * The darker 700-step ramp was rejected — Rejected/Waitlisted measures delta-E 3.9
 * deutan. Brighter-and-labelled beats darker-and-indistinguishable.
 *
 * `awaiting` is the de-emphasis gray rather than a fourth hue, being the absence of a
 * decision.
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
 * Order is the funnel's order, not a colour-safety ordering. The worst-scoring adjacent
 * pair is adjacent either way, so reordering buys nothing.
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
