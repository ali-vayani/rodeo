<script lang="ts">
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import StatusBarChart from '$lib/components/admin/StatusBarChart.svelte';
	import ActivityFeed from '$lib/components/admin/ActivityFeed.svelte';
	import ApplicantTable from '$lib/components/admin/ApplicantTable.svelte';
	import AdminStatsChart from '$lib/components/admin/AdminStatsChart.svelte';
	import { createClient } from '$lib/trpc/client';
	import { toast } from '$lib/ui/toast.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// Only the default window is server-rendered; changing it refetches over tRPC
	// rather than reloading the page, so the rest of the dashboard stays put.
	let adminStats = $state(untrack(() => data.adminStats));
	let statsWindow = $state('all');
	let statsLoading = $state(false);

	const DAY_MS = 24 * 60 * 60 * 1000;

	/**
	 * Windows are relative to now, resolved at click time rather than at load.
	 * Built by subtracting from the epoch rather than mutating a Date, so the
	 * value handed to the query can't be changed out from under it.
	 */
	function windowStart(value: string): Date | undefined {
		const days = value === '7d' ? 7 : value === '30d' ? 30 : 0;
		return days === 0 ? undefined : new Date(Date.now() - days * DAY_MS);
	}

	async function loadAdminStats(value: string) {
		statsLoading = true;
		try {
			adminStats = await trpc.stats.byAdmin.query({ from: windowStart(value) });
		} catch (e) {
			toast.fromError(e, 'Failed to load admin activity');
		} finally {
			statsLoading = false;
		}
	}

	// From `applicants`, not the whole-table `byDecision`: staff accounts never apply
	// and never hold a decision, so counting them made every card describe a
	// population that isn't being admitted.
	const a = $derived(data.stats.applicants);
	const accepted = $derived(a.accepted.total);
	const waitlisted = $derived(a.waitlisted.total);
	const rejected = $derived(a.rejected.total);
	const awaiting = $derived(a.awaiting.total);
	const confirmed = $derived(data.stats.byStatus['CONFIRMED'] ?? 0);
	const checkedIn = $derived(data.stats.byStatus['CHECKED_IN'] ?? 0);
	const confirmedCount = $derived(confirmed + checkedIn);

	const ROLE_LABELS: Record<string, string> = {
		HACKER: 'Hackers',
		JUDGE: 'Judges',
		MENTOR: 'Mentors',
		VOLUNTEER: 'Volunteers'
	};

	/** Role split for a card's hover breakdown, ordered biggest first. */
	function split(byRole: Partial<Record<string, number>>) {
		return Object.entries(byRole)
			.map(([role, value]) => ({ label: ROLE_LABELS[role] ?? role, value: value ?? 0 }))
			.sort((x, y) => y.value - x.value);
	}
</script>

<div>
	<div class="mb-6">
		<h1 class="text-[22px] font-bold text-primary">Dashboard</h1>
	</div>

	<!-- Stat cards -->
	<div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
		<StatCard label="Total applicants" value={a.total} breakdown={split(a.byRole)} />
		<StatCard label="Accepted" value={accepted} breakdown={split(a.accepted.byRole)} />
		<StatCard label="Waitlisted" value={waitlisted} breakdown={split(a.waitlisted.byRole)} />
		<StatCard label="Rejected" value={rejected} breakdown={split(a.rejected.byRole)} />
		<StatCard label="Awaiting decision" value={awaiting} breakdown={split(a.awaiting.byRole)} />
	</div>

	<!-- Bar chart + activity feed. Both named-user panels are absent for organizers,
	     so the chart takes the full width rather than leaving a gap. -->
	<div
		class="mb-5 grid grid-cols-1 gap-3 lg:items-stretch {data.stats.recentActivity
			? 'lg:grid-cols-[2fr_1fr]'
			: ''}"
	>
		<StatusBarChart byRole={data.stats.byRole} {accepted} confirmed={confirmedCount} />
		{#if data.stats.recentActivity}
			<ActivityFeed entries={data.stats.recentActivity} />
		{/if}
	</div>

	<!-- Per-admin activity. Absent for organizers, who don't get named-staff data. -->
	{#if adminStats}
		<div class="mb-5">
			<AdminStatsChart
				admins={adminStats.admins}
				unattributed={adminStats.unattributed}
				bind:window={statsWindow}
				loading={statsLoading}
				onWindowChange={loadAdminStats}
			/>
		</div>
	{/if}

	<!-- Recent applicants table -->
	{#if data.recentApplicants}
		<!-- Data-dense reference table: scrolls horizontally on narrow viewports
		     rather than squishing or card-stacking. `w-0 min-w-full` zeroes the
		     scroller's intrinsic width so the forced table width can't propagate
		     up through the layout's flex-1 main and widen the page. -->
		<div class="w-0 min-w-full overflow-x-auto">
			<div class="min-w-2xl">
				<ApplicantTable applicants={data.recentApplicants} />
			</div>
		</div>
	{/if}
</div>
