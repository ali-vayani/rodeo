<script lang="ts">
	import { Role } from '$lib/generated/prisma/enums';

	interface Props {
		selected: Role;
		onselect: (role: Role) => void;
		/** Locked alongside the answers when the application window is shut. */
		disabled?: boolean;
	}

	let { selected, onselect, disabled = false }: Props = $props();

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
				{disabled}
				class="rounded border px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed {selected ===
				role.value
					? 'border-primary bg-primary text-white'
					: 'border-border bg-white text-primary'} {disabled && selected !== role.value
					? 'opacity-50'
					: ''}"
			>
				{role.label}
			</button>
		{/each}
	</div>
</div>
