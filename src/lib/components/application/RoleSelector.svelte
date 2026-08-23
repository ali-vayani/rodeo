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

<fieldset class="border-0 p-0">
	<legend class="mb-3 p-0 text-base font-semibold text-foreground"> I am applying as </legend>
	<!--
		A four-up grid rather than a wrapping row: the four roles are a fixed set, and
		an even grid stops "Volunteer" from orphaning onto its own line at odd widths.
	-->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each roles as role (role)}
			<button
				type="button"
				onclick={() => onselect(role.value)}
				{disabled}
				aria-pressed={selected === role.value}
				class="cursor-pointer border px-3 py-3 font-display text-base font-semibold
				 transition-colors duration-150 focus-visible:shadow-ring
				 disabled:cursor-not-allowed {selected === role.value
					? 'border-brand-ink bg-brand-ink text-white'
					: 'border-border bg-card text-foreground-secondary hover:border-brand-ink hover:text-foreground'} {disabled &&
				selected !== role.value
					? 'opacity-50'
					: ''}"
			>
				{role.label}
			</button>
		{/each}
	</div>
</fieldset>
