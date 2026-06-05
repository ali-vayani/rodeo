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

<div class="bg-white border border-border rounded-md px-6 py-5 h-full">
	<div class="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-4">
		Role Breakdown
	</div>

	<div class="flex flex-col gap-[10px]">
		{#each roles as role}
			{@const count = byRole[role.key] ?? 0}
			{@const pct = (count / maxCount) * 100}
			<div class="flex items-center gap-[10px]">
				<div class="w-[72px] text-right text-xs text-[#555] shrink-0">
					{role.label}
				</div>
				<div class="flex-1 bg-muted border border-border rounded-sm h-[10px] overflow-hidden">
					<div class="h-full bg-primary rounded-sm" style="width:{pct}%"></div>
				</div>
				<div class="w-9 text-xs font-semibold text-primary shrink-0">
					{count}
				</div>
			</div>
		{/each}
	</div>

	<div class="border-t border-border my-4"></div>

	<div class="flex items-center gap-[10px]">
		<div class="w-[72px] text-right text-xs text-[#555] shrink-0">
			RSVP Rate
		</div>
		<div class="flex-1 bg-muted border border-border rounded-sm h-[10px] overflow-hidden">
			<div class="h-full bg-primary rounded-sm" style="width:{rsvpPct}%"></div>
		</div>
		<div class="w-9 text-xs font-semibold text-primary shrink-0">
			{rsvpPct}%
		</div>
	</div>
	<div class="text-[11px] text-muted-foreground mt-1.5 pl-[82px]">
		{confirmed}/{accepted} accepted confirmed
	</div>
</div>
