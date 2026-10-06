<script lang="ts">
	import { Role } from '$lib/generated/prisma/enums';
	import type { ApplicationWindowState } from '$lib/application/window';

	interface Props {
		selected: Role;
		onselect: (role: Role) => void;
		/** Locked alongside the answers when the application window is shut. */
		disabled?: boolean;
		/**
		 * Window state per role. When a role is 'closed' or 'before', its button is
		 * greyed out with a tooltip. Absent means no per-role gating (all selectable).
		 */
		roleStates?: Partial<Record<Role, ApplicationWindowState>>;
	}

	let { selected, onselect, disabled = false, roleStates }: Props = $props();

	const roles: { value: Role; label: string }[] = [
		{ value: Role.HACKER, label: 'Hacker' },
		{ value: Role.JUDGE, label: 'Judge' },
		{ value: Role.MENTOR, label: 'Mentor' },
		{ value: Role.VOLUNTEER, label: 'Volunteer' }
	];

	function roleTooltip(role: Role): string | undefined {
		if (!roleStates) return undefined;
		const state = roleStates[role];
		if (state === 'closed') return 'Applications for this role are closed';
		if (state === 'before') return 'Applications for this role have not opened yet';
		return undefined;
	}

	function isRoleUnavailable(role: Role): boolean {
		if (!roleStates) return false;
		const state = roleStates[role];
		return state === 'closed' || state === 'before';
	}
</script>

<fieldset class="border-0 p-0">
	<legend class="mb-3 p-0 text-base font-semibold text-foreground"> I am applying as </legend>
	<!--
		A four-up grid rather than a wrapping row: the four roles are a fixed set, and
		an even grid stops "Volunteer" from orphaning onto its own line at odd widths.
	-->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each roles as role (role)}
			{@const unavailable = isRoleUnavailable(role.value)}
			{@const tooltip = roleTooltip(role.value)}
			<div class="relative" title={tooltip}>
				<button
					type="button"
					onclick={() => !unavailable && onselect(role.value)}
					disabled={disabled || unavailable}
					aria-pressed={selected === role.value}
					aria-label={tooltip ? `${role.label} — ${tooltip}` : role.label}
					class="w-full cursor-pointer border px-3 py-3 font-display text-base font-semibold
					 transition-colors duration-150 focus-visible:shadow-ring
					 disabled:cursor-not-allowed {selected === role.value
						? 'border-brand-ink bg-brand-ink text-white'
						: unavailable
							? 'border-border bg-muted text-muted-foreground opacity-50'
							: 'border-border bg-card text-foreground-secondary hover:border-brand-ink hover:text-foreground'} {(disabled &&
						selected !== role.value) ||
					(unavailable && selected !== role.value)
						? 'opacity-50'
						: ''}"
				>
					{role.label}
					{#if unavailable && selected !== role.value}
						<span class="block text-2xs font-normal tracking-normal normal-case">
							{roleStates?.[role.value] === 'closed' ? 'Closed' : 'Not open yet'}
						</span>
					{/if}
				</button>
			</div>
		{/each}
	</div>
</fieldset>
