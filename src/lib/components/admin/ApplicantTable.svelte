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

	const DECISION_COLORS: Record<string, string> = {
		ACCEPTED: '#d1fae5', // green
		WAITLISTED: '#fef9c3', // yellow
		REJECTED: '#fee2e2', // red
		PENDING: '#e5e7eb', // gray
	};

	const DECISION_TEXT: Record<string, string> = {
		ACCEPTED: '#065f46', // green
		WAITLISTED: '#713f12', // yellow
		REJECTED: '#991b1b', // red
		PENDING: '#374151' // gray
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

<div style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden;">
	<div style="padding:16px 20px; border-bottom:1px solid #e0e0e0;">
		<span
			style="font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#aaaaaa;"
		>
			Recent Applicants
		</span>
	</div>

	{#if applicants.length === 0}
		<div style="padding:32px; text-align:center; font-size:13px; color:#aaaaaa;">
			No applicants yet
		</div>
	{:else}
		<table style="width:100%; border-collapse:collapse;">
			<thead>
				<tr style="background:#f9f9f9; border-bottom:1px solid #e0e0e0;">
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Name</th
					>
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Email</th
					>
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Role</th
					>
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Status</th
					>
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Decision</th
					>
					<th
						style="padding:10px 16px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#aaaaaa;"
						>Applied</th
					>
				</tr>
			</thead>
			<tbody>
				{#each applicants as applicant}
					<tr style="border-bottom:1px solid #f0f0f0;">
						<td style="padding:12px 16px; font-size:13px; font-weight:500; color:#191919;">
							{applicant.name}
						</td>
						<td style="padding:12px 16px; font-size:12px; color:#aaaaaa;">
							{applicant.email}
						</td>
						<td style="padding:12px 16px; font-size:13px; color:#333;">
							{primaryRole(applicant.roles)}
						</td>
						<td style="padding:12px 16px;">
							<span
								style="font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#555;"
							>
								{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase()}
							</span>
						</td>
						<td style="padding:12px 16px;">
							{#if applicant.activeDecision}
								<span
									style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_COLORS[applicant.activeDecision] ?? '#e5e7eb'}; color:{DECISION_TEXT[applicant.activeDecision] ?? '#374151'};"
								>
									{applicant.activeDecision.charAt(0) +
										applicant.activeDecision.slice(1).toLowerCase()}
								</span>
							{:else}
								<span style="font-size:12px; color:#aaaaaa;">—</span>
							{/if}
						</td>
						<td
							style="padding:12px 16px; font-size:12px; color:#aaaaaa; font-family:'DM Mono', monospace;"
						>
							{formatDate(applicant.createdAt)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
