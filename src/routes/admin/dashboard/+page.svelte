<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { Card, SegmentedControl } from '$lib/components/ui';
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import AdminStatsChart from '$lib/components/admin/AdminStatsChart.svelte';
	import UnifiedActivityFeed from '$lib/components/admin/UnifiedActivityFeed.svelte';
	import FunnelChart from '$lib/components/admin/charts/FunnelChart.svelte';
	import DecisionBreakdown from '$lib/components/admin/charts/DecisionBreakdown.svelte';
	import TrendChart from '$lib/components/admin/charts/TrendChart.svelte';
	import HBarChart from '$lib/components/admin/charts/HBarChart.svelte';
	import { createClient } from '$lib/trpc/client';
	import { toast } from '$lib/ui/toast.svelte';
	import { pluralize } from '$lib/format';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();
	const nf = new Intl.NumberFormat('en-US');

	type Window = '7d' | '30d' | 'all';
	type Source = 'all' | 'admin' | 'hacker';

	/**
	 * One time range for the whole page, rather than a control per card.
	 *
	 * Per-card ranges let two panels side by side describe different slices with nothing
	 * on screen saying so.
	 *
	 * It scopes only what it can honestly scope: the trend, the feed and the per-admin
	 * tallies, all of which have a timestamp. The funnel and the decision split are
	 * present-state counts, so they are marked "current" and left alone.
	 */
	const WINDOWS = [
		{ value: '7d', label: '7d' },
		{ value: '30d', label: '30d' },
		{ value: 'all', label: 'All time' }
	];

	// Only the default window is server-rendered; changing it refetches over tRPC so
	// the rest of the page stays put instead of blanking through a full navigation.
	let window = $state<string>(untrack(() => data.window));
	let trend = $state(untrack(() => data.trend));
	let activity = $state(untrack(() => data.activity));
	let adminStats = $state(untrack(() => data.adminStats));
	let activitySource = $state<string>('all');
	let rangeLoading = $state(false);
	let feedLoading = $state(false);

	/**
	 * `stats.byAdmin` predates the shared window and takes a date rather than a window
	 * name. Resolved at call time, so a page left open overnight does not keep asking for
	 * yesterday's seven days.
	 */
	function windowStart(value: string): Date | undefined {
		const days = value === '7d' ? 7 : value === '30d' ? 30 : 0;
		return days === 0 ? undefined : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	}

	async function loadWindow(next: string) {
		rangeLoading = true;
		try {
			const [nextTrend, nextActivity, nextAdminStats] = await Promise.all([
				trpc.dashboard.overTime.query({ window: next as Window }),
				// `data.activity` rather than the live `activity`: it records whether this reader is
				// an admin at all. An organizer must not start fetching a feed they were not served.
				data.activity
					? trpc.dashboard.activity.query({
							source: activitySource as Source,
							window: next as Window,
							limit: 8
						})
					: null,
				data.adminStats ? trpc.stats.byAdmin.query({ from: windowStart(next) }) : null
			]);
			trend = nextTrend;
			activity = nextActivity;
			adminStats = nextAdminStats;
		} catch (e) {
			toast.fromError(e, 'Failed to load the selected range');
		} finally {
			rangeLoading = false;
		}
	}

	async function loadActivity(source: string) {
		activitySource = source;
		feedLoading = true;
		try {
			activity = await trpc.dashboard.activity.query({
				source: source as Source,
				window: window as Window,
				limit: 8
			});
		} catch (e) {
			toast.fromError(e, 'Failed to load activity');
		} finally {
			feedLoading = false;
		}
	}

	// From `applicants`, not the whole-table `byDecision`. Staff accounts never apply and
	// never hold a decision, so counting them made every card describe the wrong population.
	const a = $derived(data.stats.applicants);

	const decisionCounts = $derived({
		accepted: a.accepted.total,
		waitlisted: a.waitlisted.total,
		rejected: a.rejected.total,
		awaiting: a.awaiting.total
	});

	const ROLE_LABELS: Record<string, string> = {
		HACKER: 'Hackers',
		JUDGE: 'Judges',
		MENTOR: 'Mentors',
		VOLUNTEER: 'Volunteers'
	};

	/** Role split behind a decision, ordered biggest first. */
	function split(byRole: Partial<Record<string, number>>) {
		return Object.entries(byRole)
			.map(([role, value]) => ({ label: ROLE_LABELS[role] ?? role, value: value ?? 0 }))
			.sort((x, y) => y.value - x.value);
	}

	const decisionByRole = $derived({
		accepted: split(a.accepted.byRole),
		waitlisted: split(a.waitlisted.byRole),
		rejected: split(a.rejected.byRole),
		awaiting: split(a.awaiting.byRole)
	});

	const stageCount = $derived(
		(key: string) => data.funnel.find((stage) => stage.key === key)?.count ?? 0
	);
	// The funnel is the one place stage counts are derived, so the header and the charts
	// cannot disagree about how many people applied.
	const applied = $derived(stageCount('applied'));

	const totals = $derived({
		scans: (adminStats?.admins ?? []).reduce((sum, admin) => sum + admin.scans, 0)
	});
</script>

<div>
	<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold text-foreground">Dashboard</h1>
			<p class="mt-0.5 text-sm text-foreground-secondary">
				{nf.format(applied)} applicants · {nf.format(a.awaiting.total)} awaiting a decision
			</p>
		</div>
		<SegmentedControl
			bind:value={window}
			options={WINDOWS}
			ariaLabel="Time range"
			disabled={rangeLoading}
			onValueChange={loadWindow}
		/>
	</div>

	<!-- The pipeline leads: "where is this cycle right now" is the question the
	     dashboard exists to answer. -->
	<div class="mb-4">
		<Card title="Admissions funnel">
			{#snippet actions()}
				<span class="font-mono text-2xs text-foreground-tertiary">current</span>
			{/snippet}
			<FunnelChart stages={data.funnel} />
		</Card>
	</div>

	<!-- The headline number and its breakdown as one unit, with the derived rates
	     beside it rather than as four more cards competing with them. -->
	<!-- The tile column is admin-only data, so for an organizer the breakdown card
	     takes the full width rather than leaving a gap where the tiles would be. -->
	<div
		class="mb-4 grid grid-cols-1 gap-4 {adminStats || data.demographics
			? 'lg:grid-cols-[2fr_1fr]'
			: ''}"
	>
		<Card title="Applicants by decision">
			{#snippet actions()}
				<span class="font-mono text-2xs text-foreground-tertiary">current</span>
			{/snippet}
			<div class="mb-4 flex items-baseline gap-2.5">
				<span class="text-3xl font-bold text-foreground">{nf.format(a.total)}</span>
				<span class="text-sm text-foreground-secondary">applicants</span>
			</div>
			<DecisionBreakdown counts={decisionCounts} byRole={decisionByRole} total={a.total} />
		</Card>

		<!-- Counts, never rates. The funnel already spells out every conversion, and
				     `StatCard` renders a plain number, so a tile reading "72" under "RSVP rate"
				     would be a percentage with its sign filed off. -->
		{#if adminStats || data.demographics}
			<div class="grid grid-cols-2 gap-4 self-start">
				<StatCard label="Awaiting" value={a.awaiting.total} breakdown={decisionByRole.awaiting} />
				{#if data.demographics}
					<StatCard
						label="Universities"
						value={data.demographics.distinctUniversities}
						breakdown={data.demographics.universities
							.slice(0, 3)
							.map((row) => ({ label: row.label, value: row.count }))}
					/>
				{/if}
				<StatCard
					label="Teams"
					value={data.stats.teams.total}
					breakdown={[{ label: 'Applicants on a team', value: data.stats.teams.members }]}
				/>
				{#if adminStats}
					<StatCard label="Scans" value={totals.scans} />
				{/if}
			</div>
		{/if}
	</div>

	<!-- Who did the work, directly under the decision split it explains: the same
		     accepted/waitlisted/rejected counts as the card above, attributed to the people
		     who set them. Reading one straight after the other is the point. -->
	{#if adminStats}
		<div class="mb-4">
			<AdminStatsChart
				admins={adminStats.admins}
				unattributed={adminStats.unattributed}
				loading={rangeLoading}
			/>
		</div>
	{/if}

	<!-- Trend and the unified feed, both scoped by the range control above. The row is
		     stretched and the feed scrolls inside its card so the two stay level: the
		     chart's height is deterministic while the feed's depends on how much happened. -->
	<div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
		<Card title="Applications & decisions per day">
			{#snippet actions()}
				<span class="font-mono text-2xs text-foreground-tertiary">
					{pluralize(trend.points.length, 'day')}
				</span>
			{/snippet}
			<!-- Held at reduced opacity on refetch rather than swapped for a skeleton:
			     the axis and the shape stay put, so the card never jumps. -->
			<div class={rangeLoading ? 'opacity-60 transition-opacity duration-150' : ''}>
				<TrendChart series={trend} />
			</div>
		</Card>

		{#if activity}
			<!-- `lg:h-0 lg:min-h-full` is what makes the CHART set the row height rather than
						     the feed. `min-h-0` alone only lets a grid item shrink, so the row is still
						     sized to max-content and the dead space just moves. Zero height removes the
						     list from that calculation, then `min-h-full` fills whatever the chart
						     decided. Only from lg, since below that the two cards stack. -->
			<Card
				title="Recent activity"
				class="flex flex-col lg:h-0 lg:min-h-full"
				bodyClass="flex-1 min-h-0 flex flex-col"
			>
				<UnifiedActivityFeed
					entries={activity}
					bind:source={activitySource}
					loading={feedLoading || rangeLoading}
					onSourceChange={loadActivity}
				/>
			</Card>
		{/if}
	</div>

	{#if data.demographics}
		{@const demo = data.demographics}
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<!-- Titled with the question's own wording rather than "Top universities", since
						     the label is whatever the form asks and "Top where do you study?" is what
						     string-concatenating a title gets you. -->
			<Card title={demo.universityLabel}>
				{#snippet actions()}
					<span class="font-mono text-2xs text-foreground-tertiary">
						top {demo.universities.length} of {nf.format(demo.distinctUniversities)}
					</span>
				{/snippet}
				<HBarChart rows={demo.universities} total={applied} wideLabels />

				{#if demo.tail}
					<!-- The tail is a residual, not a peer category. Drawn as a bar it would
										     out-length the largest single school and read as if it were one. -->
					<div
						class="mt-2.5 grid grid-cols-[minmax(5rem,11rem)_1fr_auto] items-center gap-2.5 border-t border-border pt-2.5"
					>
						<span class="text-right text-xs text-foreground-tertiary">Other</span>
						<span class="text-2xs text-foreground-tertiary">
							{nf.format(demo.tail.schools)} more, none above {nf.format(demo.tail.largest)}
						</span>
						<span
							class="w-10 text-right text-xs font-semibold text-foreground-secondary tabular-nums"
						>
							{nf.format(demo.tail.applicants)}
						</span>
					</div>
				{/if}

				{#if demo.noUniversity > 0}
					<p class="mt-2 text-2xs text-foreground-tertiary">
						{nf.format(demo.noUniversity)} with none recorded.
					</p>
				{/if}
			</Card>

			<Card title={demo.yearLabel}>
				<!-- `ordered`: Freshman → Senior is the sequence the reader expects, and
				     re-sorting by headcount makes the shape of the cohort unreadable. -->
				<HBarChart rows={demo.years} ordered emphasizeFirst={false} total={applied} />
			</Card>
		</div>
	{/if}
</div>
