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

<div class="h-full rounded-md border border-border bg-white px-6 py-5">
	<div class="mb-4 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
		Role Breakdown
	</div>

	<div class="flex flex-col gap-[10px]">
		{#each roles as role}
			{@const count = byRole[role.key] ?? 0}
			{@const pct = (count / maxCount) * 100}
			<div class="flex items-center gap-[10px]">
				<div class="w-[72px] shrink-0 text-right text-xs text-[#555]">
					{role.label}
				</div>
				<div class="h-[10px] flex-1 overflow-hidden rounded-sm border border-border bg-muted">
					<div class="h-full rounded-sm bg-primary" style="width:{pct}%"></div>
				</div>
				<div class="w-9 shrink-0 text-xs font-semibold text-primary">
					{count}
				</div>
			</div>
		{/each}
	</div>

	<div class="my-4 border-t border-border"></div>

	<div class="flex items-center gap-[10px]">
		<div class="w-[72px] shrink-0 text-right text-xs text-[#555]">RSVP Rate</div>
		<div class="h-[10px] flex-1 overflow-hidden rounded-sm border border-border bg-muted">
			<div class="h-full rounded-sm bg-primary" style="width:{rsvpPct}%"></div>
		</div>
		<div class="w-9 shrink-0 text-xs font-semibold text-primary">
			{rsvpPct}%
		</div>
	</div>
	<div class="mt-1.5 pl-[82px] text-[11px] text-muted-foreground">
		{confirmed}/{accepted} accepted confirmed
	</div>
</div>
