/**
 * Shapes for the redesigned dashboard.
 *
 * Isomorphic on purpose, exactly like `$lib/stats`: the router builds these and
 * the chart components render them, so a component can name the type without
 * importing a server-only module.
 *
 * Keep it free of Prisma, `$env`, and node builtins.
 */

/** One stage of the admissions pipeline, as the funnel draws it. */
export interface FunnelStage {
	key: 'applied' | 'decided' | 'accepted' | 'confirmed' | 'checkedIn';
	label: string;
	/** One line saying what the stage counts, shown under the label. */
	hint: string;
	count: number;
	/**
	 * Share of the *previous* stage, 0–1, or null for the first stage which has
	 * nothing to convert from.
	 *
	 * Stage-to-stage rather than share-of-applied on purpose: "46% of decided were
	 * accepted" is the number an organizer acts on. Share-of-applied is recoverable
	 * from the counts; the conversion is the thing that would otherwise need mental
	 * arithmetic at every step.
	 */
	conversion: number | null;
	/** Label for what `conversion` is a share of, e.g. "of decided". */
	conversionOf: string | null;
}

/** A single day's bucket in the trend chart. */
export interface TrendPoint {
	/** `YYYY-MM-DD` in the event's timezone — the bucket key, not a display string. */
	day: string;
	applications: number;
	decisions: number;
}

export interface TrendSeries {
	points: TrendPoint[];
	/** IANA zone the days were bucketed in, so the axis can say so if it needs to. */
	timezone: string;
	/**
	 * True when the window was clamped because the first application predates it.
	 * The chart says "all time" rather than implying the range covers everything.
	 */
	truncated: boolean;
}

/**
 * Which population an activity row came from.
 *
 * Derived from the action slug, never from the actor's current role: an organizer
 * who is later demoted must not have their past decisions silently reclassify as
 * hacker activity. The slug records what was done, which is the thing that doesn't
 * change.
 */
export type ActivitySource = 'admin' | 'hacker';

export interface ActivityEntry {
	id: string;
	source: ActivitySource;
	/** Log slug, or a synthetic `applicant.*` slug for derived rows. */
	action: string;
	/** Who acted. Null for derived rows where the subject *is* the actor. */
	actorName: string | null;
	/** The sentence, already rendered server-side: "Accepted Sarah Chen". */
	summary: string;
	timestamp: Date;
	/** Short qualifier shown as a chip — "UT Austin · Junior", "612 recipients". */
	detail: string | null;
	/** Decision tone for the chip, when the row carries one. */
	tone: 'accepted' | 'rejected' | 'waitlisted' | 'neutral';
	/** Marks the entries a reader scanning the feed should stop on. */
	notable: boolean;
}

/** One row of a single-hue magnitude chart (universities, years). */
export interface ValueCount {
	label: string;
	count: number;
}

export interface Demographics {
	/**
	 * Top universities by headcount, already cut to `topUniversities.length`.
	 * The tail is reported separately rather than appended as a bar — 800-odd
	 * applicants across 400 schools drawn as one bar would out-length the largest
	 * single university and read as if it were one.
	 */
	universities: ValueCount[];
	tail: { schools: number; applicants: number; largest: number } | null;
	/** Distinct non-empty universities held across the whole applicant pool. */
	distinctUniversities: number;
	/** Year distribution, in the question's declared option order where there is one. */
	years: ValueCount[];
	/** Applicants with no university recorded. */
	noUniversity: number;
	/** The question titles these came from, so the cards label themselves the way the form does. */
	universityLabel: string;
	yearLabel: string;
}
