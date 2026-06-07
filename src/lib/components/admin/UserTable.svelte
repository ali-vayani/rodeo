<script lang="ts">
	type User = {
		uid: string;
		name: string;
		email: string;
		roles: string[];
		status: string;
		pendingDecision: string | null;
		activeDecision: string | null;
		createdAt: Date | string;
	};

	let { users, onEdit }: { users: User[]; onEdit: (u: User) => void } = $props();

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
		for (const r of order) if (roles.includes(r)) return r.charAt(0) + r.slice(1).toLowerCase();
		const first = roles[0];
		return first ? first.charAt(0) + first.slice(1).toLowerCase() : '—';
	}

	function statusLabel(s: string): string {
		return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
	}
</script>

<div class="bg-white border border-border rounded-md overflow-hidden">
	{#if users.length === 0}
		<div class="py-12 text-center text-[13px] text-muted-foreground">No results</div>
	{:else}
		<table class="w-full border-collapse">
			<thead>
				<tr class="bg-[#f9f9f9] border-b border-border">
					{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col}
						<th class="px-[14px] py-[10px] text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground whitespace-nowrap">
							{col}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each users as user (user.uid)}
					<tr class="border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors">
						<td class="px-[14px] py-[11px] text-[13px] font-medium text-primary whitespace-nowrap">
							{user.name}
						</td>
						<td class="px-[14px] py-[11px] text-xs text-muted-foreground">
							{user.email}
						</td>
						<td class="px-[14px] py-[11px] text-[13px] text-[#333]">
							{primaryRole(user.roles)}
						</td>
						<td class="px-[14px] py-[11px]">
							<span class="text-[11px] font-semibold tracking-[0.05em] uppercase text-[#555]">
								{statusLabel(user.status)}
							</span>
						</td>
						<td class="px-[14px] py-[11px]">
							{#if user.pendingDecision}
								<span class="inline-block px-[7px] py-0.5 rounded text-[11px] font-semibold {DECISION_CLASS[user.pendingDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
									{statusLabel(user.pendingDecision)}
								</span>
							{:else}
								<span class="text-xs text-[#cccccc]">—</span>
							{/if}
						</td>
						<td class="px-[14px] py-[11px]">
							{#if user.activeDecision}
								<span class="inline-block px-[7px] py-0.5 rounded text-[11px] font-semibold {DECISION_CLASS[user.activeDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
									{statusLabel(user.activeDecision)}
								</span>
							{:else}
								<span class="text-xs text-[#cccccc]">—</span>
							{/if}
						</td>
						<td class="px-[14px] py-[11px] text-xs text-muted-foreground font-mono whitespace-nowrap">
							{formatDate(user.createdAt)}
						</td>
						<td class="px-[14px] py-[11px]">
							<button
								onclick={() => onEdit(user)}
								class="text-xs text-primary bg-transparent border border-border rounded px-[10px] py-1 cursor-pointer"
							>
								Edit
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
