<script lang="ts">
	let {
		byRole,
		accepted,
		confirmed
	}: {
		byRole: Partial<Record<string, number>>;
		accepted: number;
		confirmed: number;
	} = $props();

	const roles = [
		{ key: 'HACKER', label: 'Hackers' },
		{ key: 'MENTOR', label: 'Mentors' },
		{ key: 'JUDGE', label: 'Judges' },
		{ key: 'VOLUNTEER', label: 'Volunteers' }
	];

	const maxCount = $derived(Math.max(1, ...roles.map((r) => byRole[r.key] ?? 0)));
	const rsvpPct = $derived(accepted > 0 ? Math.round((confirmed / accepted) * 100) : 0);
</script>

<div
	style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:20px 24px; height:100%;"
>
	<div
		style="font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#aaaaaa; margin-bottom:16px;"
	>
		Role Breakdown
	</div>

	<div style="display:flex; flex-direction:column; gap:10px;">
		{#each roles as role}
			{@const count = byRole[role.key] ?? 0}
			{@const pct = (count / maxCount) * 100}
			<div style="display:flex; align-items:center; gap:10px;">
				<div style="width:72px; text-align:right; font-size:12px; color:#555; flex-shrink:0;">
					{role.label}
				</div>
				<div
					style="flex:1; background:#f4f4f4; border:1px solid #e0e0e0; border-radius:2px; height:10px; overflow:hidden;"
				>
					<div style="width:{pct}%; height:100%; background:#191919; border-radius:2px;"></div>
				</div>
				<div style="width:36px; font-size:12px; font-weight:600; color:#191919; flex-shrink:0;">
					{count}
				</div>
			</div>
		{/each}
	</div>

	<div style="border-top:1px solid #e0e0e0; margin:16px 0;"></div>

	<div style="display:flex; align-items:center; gap:10px;">
		<div style="width:72px; text-align:right; font-size:12px; color:#555; flex-shrink:0;">
			RSVP Rate
		</div>
		<div
			style="flex:1; background:#f4f4f4; border:1px solid #e0e0e0; border-radius:2px; height:10px; overflow:hidden;"
		>
			<div style="width:{rsvpPct}%; height:100%; background:#191919; border-radius:2px;"></div>
		</div>
		<div style="width:36px; font-size:12px; font-weight:600; color:#191919; flex-shrink:0;">
			{rsvpPct}%
		</div>
	</div>
	<div style="font-size:11px; color:#aaaaaa; margin-top:6px; padding-left:82px;">
		{confirmed}/{accepted} accepted confirmed
	</div>
</div>
