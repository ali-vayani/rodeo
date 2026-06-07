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

<div class="bg-white border border-border rounded-md overflow-hidden">
	<div class="px-5 py-4 border-b border-border">
		<span class="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
			Recent Applicants
		</span>
	</div>

	{#if applicants.length === 0}
		<div class="p-8 text-center text-[13px] text-muted-foreground">
			No applicants yet
		</div>
	{:else}
		<table class="w-full border-collapse">
			<thead>
				<tr class="bg-[#f9f9f9] border-b border-border">
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Name</th>
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Email</th>
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Role</th>
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Status</th>
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Decision</th>
					<th class="px-4 py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground">Applied</th>
				</tr>
			</thead>
			<tbody>
				{#each applicants as applicant}
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
							<span class="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#555]">
								{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase()}
							</span>
						</td>
						<td class="px-4 py-3">
							{#if applicant.activeDecision}
								<span class="inline-block px-2 py-0.5 rounded text-[11px] font-semibold {DECISION_CLASS[applicant.activeDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
									{applicant.activeDecision.charAt(0) +
										applicant.activeDecision.slice(1).toLowerCase()}
								</span>
							{:else}
								<span class="text-xs text-muted-foreground">—</span>
							{/if}
						</td>
						<td class="px-4 py-3 text-xs text-muted-foreground font-mono">
							{formatDate(applicant.createdAt)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
