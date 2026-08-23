<script lang="ts">
	import { computeApplicationState } from '$lib/application/state';
	import BatLogo from '$lib/components/brand/BatLogo.svelte';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';
	import { isRsvpClosed } from '$lib/application/window';
	import type { UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import type { SettingsModel } from '$lib/generated/prisma/models/Settings';

	// Only the fields this view renders, so it accepts the narrowed `user.me` payload
	// (which deliberately omits pendingDecision and the claim columns).
	type ApplicationUser = {
		name: string;
		email: string;
		status: UserStatus;
		activeDecision: DecisionStatus | null;
	};

	interface Props {
		user: ApplicationUser;
		settings: SettingsModel | null;
		onrsvp: () => Promise<void>;
		rsvping?: boolean;
		/** Why the last RSVP attempt failed, verbatim from the server. */
		rsvpError?: string | null;
		ondecline?: () => Promise<void>;
		declining?: boolean;
		declineError?: string | null;
	}

	let {
		user,
		settings,
		onrsvp,
		rsvping = false,
		rsvpError = null,
		ondecline,
		declining = false,
		declineError = null
	}: Props = $props();

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
	 * Whether `application.rsvp` would refuse on the deadline alone. Decline stays
	 * enabled either way, since the server accepts a late one on purpose.
	 */
	const rsvpClosed = $derived(isRsvpClosed(settings));

	/**
	 * The event links shown to a confirmed hacker.
	 *
	 * Both were `href=""` placeholders, which is not an inert link: it navigates to the
	 * current URL, so clicking "schedule" reloaded the page. Null renders the words as
	 * plain text instead.
	 *
	 * TODO: there is no hacker-facing schedule route yet, and no Settings column for a
	 * Discord invite. Both need to exist first.
	 */
	const scheduleUrl: string | null = null;
	const discordUrl: string | null = null;
</script>

<!--
	One card shape for every decision state, so the portal doesn't change its manners
	between "under review" and "you're in": a status badge, a headline, a short
	explanation, then the facts. Only the accepted state carries actions.
-->
{#snippet card(children: import('svelte').Snippet)}
	<!--
		The one card on the screen that the screen is about, so it gets the brackets.
		Padding is generous enough that the corners never collide with the content.
	-->
	<div class="relative mx-auto max-w-lg bg-card p-10 shadow-float">
		<BracketFrame class="inset-3.5 text-brand-ink" arm="size-5" />
		{@render children()}
	</div>
{/snippet}

{#snippet badge(label: string, tone: 'ok' | 'warn' | 'bad' | 'wait')}
	<span
		class="inline-flex items-center px-2.5 py-1 font-mono text-2xs font-medium
		 tracking-eyebrow uppercase {tone === 'ok'
			? 'bg-success-50 text-success-700'
			: tone === 'warn'
				? 'bg-warning-50 text-warning-700'
				: tone === 'bad'
					? 'bg-danger-50 text-danger-700'
					: 'bg-muted text-brand-purple'}"
	>
		{label}
	</span>
{/snippet}

{#snippet facts(rows: { label: string; value: string }[])}
	<dl class="mt-7 border-t border-brand-line-subtle">
		{#each rows as row (row.label)}
			<div
				class="flex justify-between gap-3 border-b border-brand-line-subtle py-2.5 text-base
				 last:border-b-0"
			>
				<dt class="shrink-0 text-foreground-secondary">{row.label}</dt>
				<dd class="m-0 min-w-0 text-right font-semibold break-words text-foreground">
					{row.value}
				</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#if appState === 'submitted'}
	{#snippet submitted()}
		<div class="text-center">
			<BatLogo class="mx-auto mb-4 w-16 text-brand-ink" />
			{@render badge('Under review', 'wait')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">We've got your application.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				Decisions go out on a rolling basis, so this can take a couple of weeks. We'll email you the
				moment yours is ready — there's nothing left for you to do.
			</p>
		</div>
		{@render facts([
			{ label: 'Applicant', value: user.name },
			{ label: 'Email', value: user.email },
			{ label: 'Status', value: 'Under review' }
		])}
	{/snippet}
	{@render card(submitted)}
{:else if appState === 'waitlisted'}
	{#snippet waitlisted()}
		<div class="text-center">
			{@render badge('Waitlisted', 'warn')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">You're on the waitlist.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				Spots open up every year as accepted hackers drop. If one comes free we'll email you right
				away — nothing to do in the meantime.
			</p>
		</div>
		{@render facts([
			{ label: 'Applicant', value: user.name },
			{ label: 'Email', value: user.email }
		])}
	{/snippet}
	{@render card(waitlisted)}
{:else if appState === 'rejected'}
	{#snippet rejected()}
		<div class="text-center">
			{@render badge('Not accepted', 'bad')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">Not this time.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				Thank you for applying. We had far more applications than spots and couldn't offer you one
				this year. We'd genuinely like to see you apply again.
			</p>
		</div>
		{@render facts([
			{ label: 'Applicant', value: user.name },
			{ label: 'Email', value: user.email }
		])}
	{/snippet}
	{@render card(rejected)}
{:else if appState === 'accepted'}
	{#snippet accepted()}
		<div class="text-center">
			<BatLogo class="mx-auto mb-4 w-16 text-brand-ink" />
			{@render badge('Accepted', 'ok')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">
				You're in, {user.name.split('')[0]}!
			</h2>
			<p class="mx-auto mb-6 max-w-prose text-md leading-relaxed text-foreground-secondary">
				{#if rsvpClosed}
					The deadline to confirm your spot has passed. Contact the organizers if you still plan to
					attend.
				{:else}
					Confirm your spot before the deadline to secure your place at the hackathon.
				{/if}
			</p>

			<div class="flex flex-wrap justify-center gap-3">
				<button
					type="button"
					onclick={onrsvp}
					disabled={rsvping || rsvpClosed}
					title={rsvpClosed ? `The RSVP deadline passed on ${rsvpDeadline}.` : undefined}
					class="cursor-pointer bg-brand-purple px-6 py-2.5 font-display text-md
					 font-semibold text-white transition-colors duration-150
					 hover:bg-brand-purple-hover focus-visible:shadow-ring
					 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{rsvping ? 'Confirming…' : 'Confirm my spot'}
				</button>
				{#if ondecline}
					<button
						type="button"
						onclick={() => (showDeclineConfirm = true)}
						disabled={rsvping}
						class="cursor-pointer border border-border px-6 py-2.5 font-display text-md
						 font-semibold text-foreground transition-colors duration-150
						 hover:border-brand-ink focus-visible:shadow-ring disabled:opacity-40"
					>
						Decline
					</button>
				{/if}
			</div>

			{#if rsvpError}
				<p class="mt-4 text-base text-destructive" role="alert">{rsvpError}</p>
			{/if}
			{#if settings?.RSVPDeadline}
				<p class="mt-4 font-mono text-xs text-foreground-tertiary">
					{rsvpClosed ? 'Deadline passed:' : 'Deadline:'}
					{rsvpDeadline}
				</p>
			{/if}
		</div>
	{/snippet}
	{@render card(accepted)}
{:else if appState === 'checked-in'}
	{#snippet checkedIn()}
		<div class="text-center">
			{@render badge('Checked in', 'ok')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">You're here. Go build.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				Hope you have a good time! Take a look at our
				{#if scheduleUrl}
					<a href={scheduleUrl} class="font-medium text-brand-purple underline">schedule</a>
				{:else}
					schedule
				{/if}
				and make sure to join the
				{#if discordUrl}
					<a href={discordUrl} class="font-medium text-brand-purple underline">Discord</a>.
				{:else}
					Discord.
				{/if}
			</p>
		</div>
		{@render facts([
			{ label: 'Applicant', value: user.name },
			{ label: 'Email', value: user.email }
		])}
	{/snippet}
	{@render card(checkedIn)}
{:else if appState === 'rsvpd'}
	{#snippet confirmed()}
		<div class="text-center">
			<BatLogo class="mx-auto mb-4 w-16 text-brand-ink" />
			{@render badge('Confirmed', 'ok')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">See you at the hackathon.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				Your spot is locked in. We'll send event details to {user.email} closer to the date, and your
				check-in code is on the Account page.
			</p>
		</div>
		{#if settings?.hackathonStartDate}
			{@render facts([{ label: 'Hackathon starts', value: hackathonStart }])}
		{/if}
	{/snippet}
	{@render card(confirmed)}
{:else if appState === 'declined'}
	{#snippet declined()}
		<div class="text-center">
			{@render badge('Declined', 'bad')}
			<h2 class="mt-3 mb-2 text-2xl font-extrabold text-foreground">Invitation declined.</h2>
			<p class="mx-auto max-w-prose text-md leading-relaxed text-foreground-secondary">
				You've declined your invitation and your spot has been released. We hope to see you at a
				future event.
			</p>
		</div>
		{@render facts([
			{ label: 'Applicant', value: user.name },
			{ label: 'Email', value: user.email }
		])}
	{/snippet}
	{@render card(declined)}
{/if}

<!--
	Decline confirmation. Releasing a spot is irreversible and the button that opens
	this sits next to the one that confirms, so it asks first.
-->
{#if showDeclineConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="decline-title"
	>
		<div class="modal-panel-w max-w-modal-sm bg-card p-7 shadow-lg">
			<h3 id="decline-title" class="mb-2 text-xl font-bold text-foreground">Decline your spot?</h3>
			<p class="mb-6 text-md leading-relaxed text-foreground-secondary">
				This permanently releases your spot at the hackathon and cannot be undone.
			</p>
			{#if declineError}
				<p class="mb-4 text-base text-destructive" role="alert">{declineError}</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={ondecline}
					disabled={declining}
					class="cursor-pointer bg-destructive px-5 py-2.5 font-display text-md
					 font-semibold text-destructive-foreground transition-colors duration-150
					 hover:bg-destructive-hover focus-visible:shadow-ring-danger disabled:opacity-60"
				>
					{declining ? 'Declining…' : 'Yes, decline'}
				</button>
				<button
					type="button"
					onclick={() => (showDeclineConfirm = false)}
					disabled={declining}
					class="cursor-pointer border border-border px-5 py-2.5 font-display text-md
					 font-semibold text-foreground transition-colors duration-150
					 hover:border-brand-ink focus-visible:shadow-ring disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
