/**
 * The one place decisions get a colour; everything else on the dashboard is ink.
 *
 * Validated against the `#ffffff` card surface. Two obligations every chart here meets:
 * CVD delta-E in the 6-8 band needs secondary encoding (2px surface gaps, every value
 * written as a number), and sub-3:1 contrast needs visible labels or a table view.
 *
 * The 700-step ramp was rejected: Rejected/Waitlisted measures delta-E 3.9 deutan.
 */

export type DecisionKey = 'accepted' | 'waitlisted' | 'rejected' | 'awaiting';

export interface DecisionSeries {
	key: DecisionKey;
	label: string;
	/** Literal class name: Tailwind scans source statically and never sees `bg-${key}-500`. */
	fill: string;
	dot: string;
	/** Ink for a label inside the fill, picked by the fill's luminance. */
	inlineText: string;
	hint: string;
}

// Funnel order. The worst-scoring pair is adjacent either way, so reordering buys nothing.
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
		// De-emphasis gray, not a fourth hue. Light enough that ink, not white, is legible on it.
		fill: 'bg-neutral-400',
		dot: 'bg-neutral-400',
		inlineText: 'text-foreground',
		hint: 'No released decision yet.'
	}
] as const;
