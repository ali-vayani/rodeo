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

	const DECISION_BG: Record<string, string> = {
		ACCEPTED: '#d1fae5',
		WAITLISTED: '#fef9c3',
		REJECTED: '#fee2e2',
		PENDING: '#e5e7eb'
	};
	const DECISION_FG: Record<string, string> = {
		ACCEPTED: '#065f46',
		WAITLISTED: '#713f12',
		REJECTED: '#991b1b',
		PENDING: '#374151'
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

<div style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden;">
	{#if users.length === 0}
		<div style="padding:48px; text-align:center; font-size:13px; color:#aaaaaa;">No results</div>
	{:else}
		<table style="width:100%; border-collapse:collapse;">
			<thead>
				<tr style="background:#f9f9f9; border-bottom:1px solid #e0e0e0;">
					{#each ['Name', 'Email', 'Role', 'Status', 'Pending', 'Decision', 'Created', ''] as col}
						<th
							style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa; white-space:nowrap;"
						>
							{col}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each users as user (user.uid)}
					<tr
						style="border-bottom:1px solid #f0f0f0; transition:background 0.1s;"
						onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.background = '#fafafa')}
						onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}
					>
						<td style="padding:11px 14px; font-size:13px; font-weight:500; color:#191919; white-space:nowrap;">
							{user.name}
						</td>
						<td style="padding:11px 14px; font-size:12px; color:#aaaaaa;">
							{user.email}
						</td>
						<td style="padding:11px 14px; font-size:13px; color:#333;">
							{primaryRole(user.roles)}
						</td>
						<td style="padding:11px 14px;">
							<span style="font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:#555;">
								{statusLabel(user.status)}
							</span>
						</td>
						<td style="padding:11px 14px;">
							{#if user.pendingDecision}
								<span
									style="display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[user.pendingDecision] ?? '#e5e7eb'}; color:{DECISION_FG[user.pendingDecision] ?? '#374151'};"
								>
									{statusLabel(user.pendingDecision)}
								</span>
							{:else}
								<span style="font-size:12px; color:#cccccc;">—</span>
							{/if}
						</td>
						<td style="padding:11px 14px;">
							{#if user.activeDecision}
								<span
									style="display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[user.activeDecision] ?? '#e5e7eb'}; color:{DECISION_FG[user.activeDecision] ?? '#374151'};"
								>
									{statusLabel(user.activeDecision)}
								</span>
							{:else}
								<span style="font-size:12px; color:#cccccc;">—</span>
							{/if}
						</td>
						<td
							style="padding:11px 14px; font-size:12px; color:#aaaaaa; font-family:'DM Mono', monospace; white-space:nowrap;"
						>
							{formatDate(user.createdAt)}
						</td>
						<td style="padding:11px 14px;">
							<button
								onclick={() => onEdit(user)}
								style="font-size:12px; color:#191919; background:none; border:1px solid #e0e0e0; border-radius:4px; padding:4px 10px; cursor:pointer;"
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
