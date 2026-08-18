<script lang="ts">
	/**
	 * "Add to wallet" beneath the check-in QR code.
	 *
	 * Both buttons are plain links to `+server.ts` endpoints — no tRPC client, no
	 * loading state, no error handling here. Apple's endpoint returns the signed
	 * `.pkpass` with the MIME type that makes Mobile Safari open the Add Pass sheet;
	 * Google's redirects to a freshly minted `pay.google.com` save link. Both re-check
	 * eligibility server-side, so nothing here is load-bearing for access.
	 *
	 * ## Why the ineligible state is visible rather than absent
	 *
	 * A confirmed hacker who has heard about wallet passes and finds nothing on this
	 * page files a bug. One who sees a greyed control and the date it unlocks does
	 * not. Same reasoning as the application window in `$lib/application/window.ts`:
	 * a closed deadline should not be indistinguishable from a broken page.
	 *
	 * When *neither* provider is configured this renders nothing at all — that is a
	 * deployment without wallet passes, not a hacker waiting for one.
	 */
	import { Wallet } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { formatDateLong } from '$lib/format';
	import type { WalletAvailability } from '$lib/server/trpc/routers/wallet';

	interface Props {
		availability: WalletAvailability;
		rsvpDeadline: Date | string | null | undefined;
	}

	let { availability, rsvpDeadline }: Props = $props();

	const offered = $derived(availability.apple || availability.google);

	const waitingMessage = $derived.by(() => {
		if (availability.reason !== 'RSVP_STILL_OPEN') return null;
		return rsvpDeadline
			? `Wallet passes unlock after the RSVP deadline on ${formatDateLong(rsvpDeadline)}.`
			: 'Wallet passes unlock after the RSVP deadline.';
	});
</script>

{#if availability.configured && (offered || waitingMessage)}
	<div class="rounded border border-border bg-white p-6">
		<p class="mb-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">
			ADD TO WALLET
		</p>

		{#if offered}
			<div class="flex flex-col gap-2">
				{#if availability.apple}
					<a
						href={resolve('/hacker/account/wallet/apple')}
						class="flex h-11 items-center justify-center gap-2 rounded border border-primary bg-primary
							text-sm font-medium text-white transition-opacity hover:opacity-90"
					>
						<Wallet size={18} aria-hidden="true" />
						Add to Apple Wallet
					</a>
				{/if}

				{#if availability.google}
					<a
						href={resolve('/hacker/account/wallet/google')}
						class="flex h-11 items-center justify-center gap-2 rounded border border-border
							text-sm font-medium text-primary transition-colors hover:bg-muted"
					>
						<Wallet size={18} aria-hidden="true" />
						Add to Google Wallet
					</a>
				{/if}
			</div>

			<p class="mt-3 text-center text-xs text-muted-foreground">
				Same code as above — either one scans at check-in.
			</p>
		{:else}
			<!-- Eligible one day, but not today. Show the control and say when. -->
			<div class="flex flex-col gap-2" aria-hidden="true">
				<div
					class="flex h-11 items-center justify-center gap-2 rounded border border-border
						text-sm font-medium text-muted-foreground opacity-40"
				>
					<Wallet size={18} />
					Add to Wallet
				</div>
			</div>
			<p class="mt-3 text-center text-xs text-muted-foreground">{waitingMessage}</p>
		{/if}
	</div>
{/if}
