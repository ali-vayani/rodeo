<script lang="ts">
	/**
	 * "Add to wallet" beneath the check-in QR code.
	 *
	 * Both buttons are plain links to `+server.ts` endpoints, with no tRPC client and no
	 * error handling here. Both endpoints re-check eligibility server-side, so nothing here
	 * is load-bearing for access.
	 *
	 * The ineligible state is visible rather than absent: a confirmed hacker who has heard
	 * about wallet passes and finds nothing files a bug, while one who sees a greyed
	 * control and the date it unlocks does not. Same reasoning as the application window.
	 *
	 * When neither provider is configured this renders nothing at all, since that is a
	 * deployment without wallet passes rather than a hacker waiting for one.
	 */
	import { Wallet } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { formatDateLong } from '$lib/format';
	import type { WalletAvailability } from '$lib/server/trpc/routers/wallet';

	interface Props {
		availability: WalletAvailability;
		rsvpDeadline: Date | string | null | undefined;
		/** The fallback unlock date when no RSVP deadline is configured. */
		eventStart: Date | string | null | undefined;
	}

	let { availability, rsvpDeadline, eventStart }: Props = $props();

	const offered = $derived(availability.apple || availability.google);

	const waitingMessage = $derived.by(() => {
		if (availability.reason !== 'RSVP_STILL_OPEN') return null;
		if (rsvpDeadline) {
			return `Wallet passes unlock after the RSVP deadline on ${formatDateLong(rsvpDeadline)}.`;
		}
		return eventStart
			? `Wallet passes unlock when the event starts on ${formatDateLong(eventStart)}.`
			: 'Wallet passes unlock once the attendee list is final.';
	});
</script>

{#if availability.configured && (offered || waitingMessage)}
	<div class=" bg-card px-6 py-6 shadow-float">
		<h2 class="mb-4 text-lg font-bold text-foreground">Add to wallet</h2>

		{#if offered}
			<div class="flex flex-col gap-2">
				{#if availability.apple}
					<a
						href={resolve('/hacker/account/wallet/apple')}
						class="flex h-11 items-center justify-center gap-2 bg-brand-ink font-display
							text-md font-semibold text-white no-underline transition-colors duration-150
							hover:bg-primary-hover focus-visible:shadow-ring"
					>
						<Wallet size={18} aria-hidden="true" />
						Add to Apple Wallet
					</a>
				{/if}

				{#if availability.google}
					<a
						href={resolve('/hacker/account/wallet/google')}
						class="flex h-11 items-center justify-center gap-2 border border-border
							font-display text-md font-semibold text-foreground no-underline transition-colors
							duration-150 hover:border-brand-ink focus-visible:shadow-ring"
					>
						<Wallet size={18} aria-hidden="true" />
						Add to Google Wallet
					</a>
				{/if}
			</div>

			<p class="mt-3 text-center text-xs text-foreground-tertiary">
				Same code as above — either one scans at check-in.
			</p>
		{:else}
			<!-- Eligible one day, but not today. Show the control and say when. -->
			<div class="flex flex-col gap-2" aria-hidden="true">
				<div
					class="flex h-11 items-center justify-center gap-2 border border-border
						font-display text-md font-semibold text-muted-foreground opacity-40"
				>
					<Wallet size={18} />
					Add to Wallet
				</div>
			</div>
			<p class="mt-3 text-center text-xs text-foreground-tertiary">{waitingMessage}</p>
		{/if}
	</div>
{/if}
