<script lang="ts">
	import { computeApplicationState } from '$lib/application/state';
	import type { UserModel } from '$lib/generated/prisma/models/User';
	import type { SettingsModel } from '$lib/generated/prisma/models/Settings';

	interface Props {
		user: UserModel;
		settings: SettingsModel | null;
		onrsvp: () => Promise<void>;
		rsvping?: boolean;
		ondecline?: () => Promise<void>;
		declining?: boolean;
	}

	let { user, settings, onrsvp, rsvping = false, ondecline, declining = false }: Props = $props();

	const appState = $derived(computeApplicationState(user));

	let showDeclineConfirm = $state(false);

	function formatDate(d: Date | null | undefined): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const rsvpDeadline = $derived(formatDate(settings?.RSVPDeadline));
	const hackathonStart = $derived(formatDate(settings?.hackathonStartDate));

	// TODO: fill in when URLs are ready
	const scheduleUrl = '';
	const discordUrl = '';
</script>

{#if appState === 'submitted'}
	<!-- Submitted / Pending Review -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-sm"
				style="border-color: #191919; color: #191919"
			>
				✓
			</div>
			<span class="text-sm font-medium" style="color: #191919">Application submitted</span>
		</div>
		<h2 class="mb-2 text-xl font-light leading-snug" style="color: #191919; letter-spacing: -0.02em">
			We've received<br />your application.
		</h2>
		<p class="mb-6 text-sm leading-relaxed" style="color: #aaaaaa">
			Decisions are sent on a rolling basis. You'll hear from us soon.
		</p>
		<div class="border-t pt-5" style="border-color: #e0e0e0">
			<div class="mb-2 flex justify-between text-sm">
				<span style="color: #aaaaaa">Name</span>
				<span class="font-medium" style="color: #191919">{user.name}</span>
			</div>
			<div class="mb-2 flex justify-between text-sm">
				<span style="color: #aaaaaa">Email</span>
				<span class="font-medium" style="color: #191919">{user.email}</span>
			</div>
			<div class="flex justify-between text-sm">
				<span style="color: #aaaaaa">Status</span>
				<span
					class="rounded px-2 py-0.5 font-mono text-xs font-medium"
					style="background: #f4f4f4; color: #aaaaaa"
				>
					UNDER REVIEW
				</span>
			</div>
		</div>
	</div>

{:else if appState === 'waitlisted'}
	<!-- Waitlisted -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold" style="color: #191919">Application Status</h2>
			<span
				class="rounded border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide"
				style="border-color: #191919; color: #191919; background: #f4f4f4"
			>
				Waitlisted
			</span>
		</div>
		<div class="border-t" style="border-color: #e0e0e0">
			<div class="flex justify-between border-b py-2.5 text-sm" style="border-color: #e0e0e0">
				<span style="color: #aaaaaa">Applicant</span>
				<span class="font-medium" style="color: #191919">{user.name}</span>
			</div>
			<div class="flex justify-between border-b py-2.5 text-sm" style="border-color: #e0e0e0">
				<span style="color: #aaaaaa">Email</span>
				<span class="font-medium" style="color: #191919">{user.email}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span style="color: #aaaaaa">Decision</span>
				<span class="font-medium" style="color: #191919">Waitlisted</span>
			</div>
		</div>
		<div class="mt-4 rounded border p-4" style="border-color: #e0e0e0; background: #f4f4f4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
				What's next
			</p>
			<p class="text-sm leading-relaxed" style="color: #191919">
				You're on the waitlist. If spots open up, we'll notify you by email. Keep an eye on your
				inbox!
			</p>
		</div>
	</div>

{:else if appState === 'rejected'}
	<!-- Rejected -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold" style="color: #191919">Application Status</h2>
			<span
				class="rounded border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide"
				style="border-color: #e0e0e0; color: #aaaaaa; background: #f4f4f4"
			>
				Not accepted
			</span>
		</div>
		<div class="border-t" style="border-color: #e0e0e0">
			<div class="flex justify-between border-b py-2.5 text-sm" style="border-color: #e0e0e0">
				<span style="color: #aaaaaa">Applicant</span>
				<span class="font-medium" style="color: #191919">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span style="color: #aaaaaa">Email</span>
				<span class="font-medium" style="color: #191919">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border p-4" style="border-color: #e0e0e0; background: #f4f4f4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
				A note from us
			</p>
			<p class="text-sm leading-relaxed" style="color: #191919">
				Thank you for applying. Unfortunately we weren't able to offer you a spot this event. We
				hope to see you next time.
			</p>
		</div>
	</div>

{:else if appState === 'accepted'}
	<!-- Accepted — RSVP prompt -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-2">
			<span
				class="rounded px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide"
				style="background: #191919; color: #fff"
			>
				Accepted
			</span>
		</div>
		<h2 class="mb-2 mt-3 text-xl font-semibold leading-snug" style="color: #191919; letter-spacing: -0.01em">
			You're in, {user.name.split(' ')[0]}!
		</h2>
		<p class="mb-6 text-sm leading-relaxed" style="color: #aaaaaa">
			Confirm your spot before the deadline to secure your place at the hackathon.
		</p>
		<div class="mb-4 flex gap-3">
			<button
				type="button"
				onclick={onrsvp}
				disabled={rsvping}
				class="rounded px-5 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
				style="background: #191919; color: #fff"
			>
				{rsvping ? 'Confirming…' : 'RSVP Yes'}
			</button>
			{#if ondecline}
				<button
					type="button"
					onclick={() => (showDeclineConfirm = true)}
					disabled={rsvping}
					class="rounded border px-5 py-2 text-sm transition-colors hover:bg-[--color-muted] disabled:opacity-40"
					style="border-color: #e0e0e0; color: #191919"
				>
					Decline
				</button>
			{/if}
		</div>
		{#if settings?.RSVPDeadline}
			<p class="text-xs" style="color: #aaaaaa">
				Deadline: {rsvpDeadline}
			</p>
		{/if}
	</div>
{:else if appState === 'checked-in'}
	<!-- Checked in -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold" style="color: #191919">Application Status</h2>
			<span
				class="rounded border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide"
				style="border-color: #191919; color: #aaaaaa; background: #f4f4f4"
			>
				Checked in
			</span>
		</div>
		<div class="border-t" style="border-color: #e0e0e0">
			<div class="flex justify-between border-b py-2.5 text-sm" style="border-color: #e0e0e0">
				<span style="color: #aaaaaa">Applicant</span>
				<span class="font-medium" style="color: #191919">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span style="color: #aaaaaa">Email</span>
				<span class="font-medium" style="color: #191919">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border p-4" style="border-color: #e0e0e0; background: #f4f4f4">
			<p class="text-sm leading-relaxed" style="color: #191919">
				Hope you have a good time! Take a look at our
				<a href={scheduleUrl} class="underline" style="color: #191919">schedule</a>
				and make sure to join the
				<a href={discordUrl} class="underline" style="color: #191919">Discord</a>.
			</p>
		</div>
	</div>

{:else if appState === 'rsvpd'}
	<!-- RSVP confirmed -->
	<div
		class="mx-auto max-w-md rounded border bg-white p-8 text-center"
		style="border-color: #e0e0e0"
	>
		<div class="mb-4 text-3xl" style="filter: grayscale(1)">★</div>
		<p class="mb-1 font-mono text-xs uppercase tracking-widest" style="color: #aaaaaa">
			RSVP Confirmed
		</p>
		<h2
			class="mb-3 mt-2 text-xl font-light leading-snug"
			style="color: #191919; letter-spacing: -0.02em"
		>
			See you at the hackathon.
		</h2>
		<p class="mb-6 text-sm leading-relaxed" style="color: #aaaaaa">
			Your spot is confirmed. We'll send event details to {user.email} closer to the date.
		</p>
		{#if settings?.hackathonStartDate}
			<div class="flex justify-center gap-2">
				<span
					class="rounded border px-3 py-1 font-mono text-xs"
					style="border-color: #191919; color: #191919"
				>
					{hackathonStart}
				</span>
			</div>
		{/if}
	</div>

{:else if appState === 'declined'}
	<!-- Declined -->
	<div class="mx-auto max-w-md rounded border bg-white p-8" style="border-color: #e0e0e0">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold" style="color: #191919">Invitation Declined</h2>
			<span
				class="rounded border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide"
				style="border-color: #e0e0e0; color: #aaaaaa; background: #f4f4f4"
			>
				Declined
			</span>
		</div>
		<div class="border-t" style="border-color: #e0e0e0">
			<div class="flex justify-between border-b py-2.5 text-sm" style="border-color: #e0e0e0">
				<span style="color: #aaaaaa">Applicant</span>
				<span class="font-medium" style="color: #191919">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span style="color: #aaaaaa">Email</span>
				<span class="font-medium" style="color: #191919">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border p-4" style="border-color: #e0e0e0; background: #f4f4f4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
				What's next
			</p>
			<p class="text-sm leading-relaxed" style="color: #191919">
				You've declined your invitation. Your spot has been released. We hope to see you at a future
				event!
			</p>
		</div>
	</div>
{/if}

<!-- Decline confirmation modal -->
{#if showDeclineConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center"
		style="background: rgba(0,0,0,0.4)"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-80 rounded border bg-white p-6 shadow-lg" style="border-color: #e0e0e0">
			<h3 class="mb-2 text-base font-semibold" style="color: #191919">Decline your spot?</h3>
			<p class="mb-5 text-sm leading-relaxed" style="color: #aaaaaa">
				This will permanently release your spot and cannot be undone.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={ondecline}
					disabled={declining}
					class="rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
					style="background: #b00000; color: #fff"
				>
					{declining ? 'Declining…' : 'Yes, decline'}
				</button>
				<button
					type="button"
					onclick={() => (showDeclineConfirm = false)}
					disabled={declining}
					class="rounded border px-4 py-2 text-sm transition-colors hover:bg-[#f4f4f4] disabled:opacity-40"
					style="border-color: #e0e0e0; color: #191919"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
