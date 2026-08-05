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

	/**
	 * The event links shown to a confirmed hacker.
	 *
	 * Both were `href=""` placeholders, which is not an inert link — it navigates
	 * to the current URL, so a confirmed hacker clicking "schedule" got a page
	 * reload. Null renders the words as plain text instead, and the anchors come
	 * back the moment there is somewhere to point them.
	 *
	 * TODO: there is no hacker-facing schedule route yet (only /admin/schedule),
	 * and no Settings column for a Discord invite. Both need to exist first.
	 */
	const scheduleUrl: string | null = null;
	const discordUrl: string | null = null;
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
		<h2 class="mb-2 text-xl leading-snug font-light tracking-[-0.02em] text-primary">
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
				<span
					class="rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground"
				>
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
				class="rounded border border-primary bg-muted px-2.5 py-0.5 font-mono text-xs font-medium tracking-wide text-primary uppercase"
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
			<p class="mb-1 text-xs font-medium tracking-widest text-muted-foreground uppercase">
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
				class="rounded border border-border bg-muted px-2.5 py-0.5 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
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
			<p class="mb-1 text-xs font-medium tracking-widest text-muted-foreground uppercase">
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
				class="rounded bg-primary px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-white uppercase"
			>
				Accepted
			</span>
		</div>
		<h2 class="mt-3 mb-2 text-xl leading-snug font-semibold tracking-[-0.01em] text-primary">
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
				class="rounded bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
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
				class="rounded border border-primary bg-muted px-2.5 py-0.5 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
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
				{#if scheduleUrl}
					<a href={scheduleUrl} class="text-primary underline">schedule</a>
				{:else}
					schedule
				{/if}
				and make sure to join the
				{#if discordUrl}
					<a href={discordUrl} class="text-primary underline">Discord</a>.
				{:else}
					Discord.
				{/if}
			</p>
		</div>
	</div>
{:else if appState === 'rsvpd'}
	<!-- RSVP confirmed -->
	<div class="mx-auto max-w-md rounded border border-border bg-white p-8 text-center">
		<div class="mb-4 text-3xl grayscale">★</div>
		<p class="mb-1 font-mono text-xs tracking-widest text-muted-foreground uppercase">
			RSVP Confirmed
		</p>
		<h2 class="mt-2 mb-3 text-xl leading-snug font-light tracking-[-0.02em] text-primary">
			See you at the hackathon.
		</h2>
		<p class="mb-6 text-sm leading-relaxed text-muted-foreground">
			Your spot is confirmed. We'll send event details to {user.email} closer to the date.
		</p>
		{#if settings?.hackathonStartDate}
			<div class="flex justify-center gap-2">
				<span class="rounded border border-primary px-3 py-1 font-mono text-xs text-primary">
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
				class="rounded border border-border bg-muted px-2.5 py-0.5 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
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
			<p class="mb-1 text-xs font-medium tracking-widest text-muted-foreground uppercase">
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
					class="rounded bg-destructive px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
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
