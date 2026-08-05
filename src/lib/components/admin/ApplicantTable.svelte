<script lang="ts">
	let {
		applicants
	}: {
		applicants: Array<{
			uid: string;
			name: string;
			email: string;
			roles: string[];
			status: string;
			activeDecision: string | null;
			createdAt: Date | string;
		}>;
	} = $props();

	const DECISION_CLASS: Record<string, string> = {
		ACCEPTED: 'bg-[#d1fae5] text-[#065f46]',
		WAITLISTED: 'bg-[#fef9c3] text-[#713f12]',
		REJECTED: 'bg-[#fee2e2] text-[#991b1b]',
		PENDING: 'bg-[#e5e7eb] text-[#374151]'
	};

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function primaryRole(roles: string[]): string {
		const order = ['HACKER', 'MENTOR', 'JUDGE', 'VOLUNTEER', 'ORGANIZER', 'ADMIN'];
		for (const r of order) {
			if (roles.includes(r)) return r.charAt(0) + r.slice(1).toLowerCase();
		}
		return roles[0] ?? '—';
	}
</script>

<div class="overflow-hidden rounded-md border border-border bg-white">
	<div class="border-b border-border px-5 py-4">
		<span class="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
			Recent Applicants
		</span>
	</div>

	{#if applicants.length === 0}
		<div class="p-8 text-center text-[13px] text-muted-foreground">No applicants yet</div>
	{:else}
		<table class="w-full border-collapse">
			<thead>
				<tr class="border-b border-border bg-[#f9f9f9]">
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Name</th
					>
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Email</th
					>
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Role</th
					>
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Status</th
					>
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Decision</th
					>
					<th
						class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
						>Applied</th
					>
				</tr>
			</thead>
			<tbody>
				{#each applicants as applicant (applicant.uid)}
					<tr class="border-b border-[#f0f0f0]">
						<td class="px-4 py-3 text-[13px] font-medium text-primary">
							{applicant.name}
						</td>
						<td class="px-4 py-3 text-xs text-muted-foreground">
							{applicant.email}
						</td>
						<td class="px-4 py-3 text-[13px] text-[#333]">
							{primaryRole(applicant.roles)}
						</td>
						<td class="px-4 py-3">
							<span class="text-[11px] font-semibold tracking-[0.06em] text-[#555] uppercase">
								{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase()}
							</span>
						</td>
						<td class="px-4 py-3">
							{#if applicant.activeDecision}
								<span
									class="inline-block rounded px-2 py-0.5 text-[11px] font-semibold {DECISION_CLASS[
										applicant.activeDecision
									] ?? 'bg-[#e5e7eb] text-[#374151]'}"
								>
									{applicant.activeDecision.charAt(0) +
										applicant.activeDecision.slice(1).toLowerCase()}
								</span>
							{:else}
								<span class="text-xs text-muted-foreground">—</span>
							{/if}
						</td>
						<td class="px-4 py-3 font-mono text-xs text-muted-foreground">
							{formatDate(applicant.createdAt)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
