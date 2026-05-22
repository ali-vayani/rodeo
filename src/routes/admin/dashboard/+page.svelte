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
	<div style="margin-bottom:24px;">
		<h1 style="font-size:22px; font-weight:700; color:#191919; margin:0;">Dashboard</h1>
	</div>

	<!-- Stat cards -->
	<div
		style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:20px;"
	>
		<StatCard label="Total" value={data.stats.total} />
		<StatCard label="Accepted" value={accepted} />
		<StatCard label="Waitlisted" value={waitlisted} />
		<StatCard label="Rejected" value={rejected} />
		<StatCard label="Pending" value={pending} />
	</div>

	<!-- Bar chart + activity feed -->
	<div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:20px; align-items:stretch;">
		<StatusBarChart byRole={data.stats.byRole} {accepted} confirmed={confirmedCount} />
		<ActivityFeed entries={data.stats.recentActivity} />
	</div>

	<!-- Recent applicants table -->
	<ApplicantTable applicants={data.recentApplicants} />
</div>
