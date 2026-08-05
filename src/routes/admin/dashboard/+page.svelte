<script lang="ts">
	import type { PageData } from './$types';
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import StatusBarChart from '$lib/components/admin/StatusBarChart.svelte';
	import ActivityFeed from '$lib/components/admin/ActivityFeed.svelte';
	import ApplicantTable from '$lib/components/admin/ApplicantTable.svelte';

	let { data }: { data: PageData } = $props();

	const d = $derived(data.stats.byDecision);
	const accepted = $derived(d['ACCEPTED'] ?? 0);
	const waitlisted = $derived(d['WAITLISTED'] ?? 0);
	const rejected = $derived(d['REJECTED'] ?? 0);
	const pending = $derived(d['PENDING'] ?? 0);
	const confirmed = $derived(data.stats.byStatus['CONFIRMED'] ?? 0);
	const checkedIn = $derived(data.stats.byStatus['CHECKED_IN'] ?? 0);
	const confirmedCount = $derived(confirmed + checkedIn);
</script>

<div>
	<div class="mb-6">
		<h1 class="text-[22px] font-bold text-primary">Dashboard</h1>
	</div>

	<!-- Stat cards -->
	<div class="mb-5 grid grid-cols-5 gap-3">
		<StatCard label="Total" value={data.stats.total} />
		<StatCard label="Accepted" value={accepted} />
		<StatCard label="Waitlisted" value={waitlisted} />
		<StatCard label="Rejected" value={rejected} />
		<StatCard label="Pending" value={pending} />
	</div>

	<!-- Bar chart + activity feed. Both named-user panels are absent for organizers,
	     so the chart takes the full width rather than leaving a gap. -->
	<div
		class="mb-5 grid items-stretch gap-3 {data.stats.recentActivity
			? 'grid-cols-[2fr_1fr]'
			: 'grid-cols-1'}"
	>
		<StatusBarChart byRole={data.stats.byRole} {accepted} confirmed={confirmedCount} />
		{#if data.stats.recentActivity}
			<ActivityFeed entries={data.stats.recentActivity} />
		{/if}
	</div>

	<!-- Recent applicants table -->
	{#if data.recentApplicants}
		<ApplicantTable applicants={data.recentApplicants} />
	{/if}
</div>
