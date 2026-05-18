<script lang="ts">
	import { UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import type { UserModel } from '$lib/generated/prisma/models/User';
	import type { SettingsModel } from '$lib/generated/prisma/models/Settings';

	interface Props {
		user: UserModel;
		settings: SettingsModel | null;
		onrsvp: () => Promise<void>;
		rsvping?: boolean;
	}

	let { user, settings, onrsvp, rsvping = false }: Props = $props();

	type AppState = 'submitted' | 'waitlisted' | 'accepted' | 'rejected' | 'rsvpd';

	function getState(): AppState {
		if (user.status === UserStatus.CONFIRMED) return 'rsvpd';
		if (user.activeDecision === DecisionStatus.ACCEPTED) return 'accepted';
		if (user.activeDecision === DecisionStatus.WAITLISTED) return 'waitlisted';
		if (user.activeDecision === DecisionStatus.REJECTED) return 'rejected';
		return 'submitted';
	}

	const state = $derived(getState());

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
</script>

{#if state === 'submitted'}
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

{:else if state === 'waitlisted'}
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

{:else if state === 'rejected'}
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

{:else if state === 'accepted'}
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
		</div>
		{#if settings?.RSVPDeadline}
			<p class="text-xs" style="color: #aaaaaa">
				Deadline: {rsvpDeadline}
			</p>
		{/if}
	</div>

{:else if state === 'rsvpd'}
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
{/if}
