<script lang="ts">
	import { Role } from '$lib/generated/prisma/enums';

	interface Props {
		selected: Role;
		onselect: (role: Role) => void;
	}

	let { selected, onselect }: Props = $props();

	const roles: { value: Role; label: string }[] = [
		{ value: Role.HACKER, label: 'Hacker' },
		{ value: Role.JUDGE, label: 'Judge' },
		{ value: Role.MENTOR, label: 'Mentor' },
		{ value: Role.VOLUNTEER, label: 'Volunteer' }
	];
</script>

<div>
	<p class="mb-2 text-xs font-medium tracking-widest text-muted-foreground uppercase">
		I am applying as
	</p>
	<div class="flex flex-wrap gap-2">
		{#each roles as role (role)}
			<button
				type="button"
				onclick={() => onselect(role.value)}
				class="rounded border px-4 py-1.5 text-sm font-medium transition-colors {selected ===
				role.value
					? 'border-primary bg-primary text-white'
					: 'border-border bg-white text-primary'}"
			>
				{role.label}
			</button>
		{/each}
	</div>
</div>
