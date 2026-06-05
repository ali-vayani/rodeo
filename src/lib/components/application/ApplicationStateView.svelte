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
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary text-sm text-primary"
			>
				✓
			</div>
			<span class="text-sm font-medium text-primary">Application submitted</span>
		</div>
		<h2 class="mb-2 text-xl font-light leading-snug text-primary tracking-[-0.02em]">
			We've received<br />your application.
		</h2>
		<p class="mb-6 text-sm leading-relaxed text-muted-foreground">
			Decisions are sent on a rolling basis. You'll hear from us soon.
		</p>
		<div class="border-t border-border pt-5">
			<div class="mb-2 flex justify-between text-sm">
				<span class="text-muted-foreground">Name</span>
				<span class="font-medium text-primary">{user.name}</span>
			</div>
			<div class="mb-2 flex justify-between text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium text-primary">{user.email}</span>
			</div>
			<div class="flex justify-between text-sm">
				<span class="text-muted-foreground">Status</span>
				<span class="rounded px-2 py-0.5 font-mono text-xs font-medium bg-muted text-muted-foreground">
					UNDER REVIEW
				</span>
			</div>
		</div>
	</div>

{:else if appState === 'waitlisted'}
	<!-- Waitlisted -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold text-primary">Application Status</h2>
			<span
				class="rounded border border-primary px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-primary bg-muted"
			>
				Waitlisted
			</span>
		</div>
		<div class="border-t border-border">
			<div class="flex justify-between border-b border-border py-2.5 text-sm">
				<span class="text-muted-foreground">Applicant</span>
				<span class="font-medium text-primary">{user.name}</span>
			</div>
			<div class="flex justify-between border-b border-border py-2.5 text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium text-primary">{user.email}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span class="text-muted-foreground">Decision</span>
				<span class="font-medium text-primary">Waitlisted</span>
			</div>
		</div>
		<div class="mt-4 rounded border border-border bg-muted p-4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
				What's next
			</p>
			<p class="text-sm leading-relaxed text-primary">
				You're on the waitlist. If spots open up, we'll notify you by email. Keep an eye on your
				inbox!
			</p>
		</div>
	</div>

{:else if appState === 'rejected'}
	<!-- Rejected -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold text-primary">Application Status</h2>
			<span
				class="rounded border border-border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted"
			>
				Not accepted
			</span>
		</div>
		<div class="border-t border-border">
			<div class="flex justify-between border-b border-border py-2.5 text-sm">
				<span class="text-muted-foreground">Applicant</span>
				<span class="font-medium text-primary">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium text-primary">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border border-border bg-muted p-4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
				A note from us
			</p>
			<p class="text-sm leading-relaxed text-primary">
				Thank you for applying. Unfortunately we weren't able to offer you a spot this event. We
				hope to see you next time.
			</p>
		</div>
	</div>

{:else if appState === 'accepted'}
	<!-- Accepted — RSVP prompt -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-2">
			<span
				class="rounded px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide bg-primary text-white"
			>
				Accepted
			</span>
		</div>
		<h2 class="mb-2 mt-3 text-xl font-semibold leading-snug text-primary tracking-[-0.01em]">
			You're in, {user.name.split(' ')[0]}!
		</h2>
		<p class="mb-6 text-sm leading-relaxed text-muted-foreground">
			Confirm your spot before the deadline to secure your place at the hackathon.
		</p>
		<div class="mb-4 flex gap-3">
			<button
				type="button"
				onclick={onrsvp}
				disabled={rsvping}
				class="rounded px-5 py-2 text-sm font-medium bg-primary text-white transition-opacity disabled:opacity-60"
			>
				{rsvping ? 'Confirming…' : 'RSVP Yes'}
			</button>
			{#if ondecline}
				<button
					type="button"
					onclick={() => (showDeclineConfirm = true)}
					disabled={rsvping}
					class="rounded border border-border px-5 py-2 text-sm text-primary transition-colors hover:bg-[--color-muted] disabled:opacity-40"
				>
					Decline
				</button>
			{/if}
		</div>
		{#if settings?.RSVPDeadline}
			<p class="text-xs text-muted-foreground">
				Deadline: {rsvpDeadline}
			</p>
		{/if}
	</div>
{:else if appState === 'checked-in'}
	<!-- Checked in -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold text-primary">Application Status</h2>
			<span
				class="rounded border border-primary px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted"
			>
				Checked in
			</span>
		</div>
		<div class="border-t border-border">
			<div class="flex justify-between border-b border-border py-2.5 text-sm">
				<span class="text-muted-foreground">Applicant</span>
				<span class="font-medium text-primary">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium text-primary">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border border-border bg-muted p-4">
			<p class="text-sm leading-relaxed text-primary">
				Hope you have a good time! Take a look at our
				<a href={scheduleUrl} class="underline text-primary">schedule</a>
				and make sure to join the
				<a href={discordUrl} class="underline text-primary">Discord</a>.
			</p>
		</div>
	</div>

{:else if appState === 'rsvpd'}
	<!-- RSVP confirmed -->
	<div
		class="mx-auto max-w-md rounded border border-border bg-white p-8 text-center"
	>
		<div class="mb-4 text-3xl grayscale">★</div>
		<p class="mb-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
			RSVP Confirmed
		</p>
		<h2
			class="mb-3 mt-2 text-xl font-light leading-snug text-primary tracking-[-0.02em]"
		>
			See you at the hackathon.
		</h2>
		<p class="mb-6 text-sm leading-relaxed text-muted-foreground">
			Your spot is confirmed. We'll send event details to {user.email} closer to the date.
		</p>
		{#if settings?.hackathonStartDate}
			<div class="flex justify-center gap-2">
				<span
					class="rounded border border-primary px-3 py-1 font-mono text-xs text-primary"
				>
					{hackathonStart}
				</span>
			</div>
		{/if}
	</div>

{:else if appState === 'declined'}
	<!-- Declined -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold text-primary">Invitation Declined</h2>
			<span
				class="rounded border border-border px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted"
			>
				Declined
			</span>
		</div>
		<div class="border-t border-border">
			<div class="flex justify-between border-b border-border py-2.5 text-sm">
				<span class="text-muted-foreground">Applicant</span>
				<span class="font-medium text-primary">{user.name}</span>
			</div>
			<div class="flex justify-between py-2.5 text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium text-primary">{user.email}</span>
			</div>
		</div>
		<div class="mt-4 rounded border border-border bg-muted p-4">
			<p class="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
				What's next
			</p>
			<p class="text-sm leading-relaxed text-primary">
				You've declined your invitation. Your spot has been released. We hope to see you at a future
				event!
			</p>
		</div>
	</div>
{/if}

<!-- Decline confirmation modal -->
{#if showDeclineConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-80 rounded border border-border bg-white p-6 shadow-lg">
			<h3 class="mb-2 text-base font-semibold text-primary">Decline your spot?</h3>
			<p class="mb-5 text-sm leading-relaxed text-muted-foreground">
				This will permanently release your spot and cannot be undone.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={ondecline}
					disabled={declining}
					class="rounded px-4 py-2 text-sm font-medium bg-destructive text-white transition-opacity disabled:opacity-60"
				>
					{declining ? 'Declining…' : 'Yes, decline'}
				</button>
				<button
					type="button"
					onclick={() => (showDeclineConfirm = false)}
					disabled={declining}
					class="rounded border border-border px-4 py-2 text-sm text-primary transition-colors hover:bg-[#f4f4f4] disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
