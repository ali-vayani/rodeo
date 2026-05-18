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
	<p class="mb-2 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
		I am applying as
	</p>
	<div class="flex flex-wrap gap-2">
		{#each roles as role}
			<button
				type="button"
				onclick={() => onselect(role.value)}
				class="rounded border px-4 py-1.5 text-sm font-medium transition-colors"
				style={selected === role.value
					? 'background: #191919; color: #fff; border-color: #191919;'
					: 'background: #fff; color: #191919; border-color: #e0e0e0;'}
			>
				{role.label}
			</button>
		{/each}
	</div>
</div>
