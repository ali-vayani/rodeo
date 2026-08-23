<script lang="ts">
	import { resolve } from '$app/paths';
	import { createClient } from '$lib/trpc/client';
	import { errorMessage } from '$lib/ui/errors';
	import type { TeamIneligibility } from '$lib/team/eligibility';

	/**
	 * The pending team invitation, rendered above every page of the hacker portal.
	 *
	 * Mounted from `hacker/+layout.svelte` rather than from a page, which is the point: the
	 * layout survives client-side navigation, so dismissing it is a decision the hacker
	 * makes once.
	 */

	const MAX_TEAM_SIZE = 4;

	interface Invite {
		teamName: string;
		memberCount: number;
		inviteCode: string;
		/** Why this account may not join, or null if it may — see the layout load. */
		ineligibility: TeamIneligibility | null;
	}

	let { invite }: { invite: Invite } = $props();

	const trpc = createClient();

	let joining = $state(false);
	let joinError = $state<string | null>(null);
	let joined = $state(false);
	let dismissed = $state(false);

	const full = $derived(invite.memberCount >= MAX_TEAM_SIZE);

	/**
	 * Phrased for the banner rather than reused from `TEAM_INELIGIBLE_MESSAGE`, which
	 * answers "why were you refused" after the fact. Here nothing has been attempted yet,
	 * and the two cases want opposite tones: a pending RSVP is a next step, a non-hacker
	 * account is a dead end.
	 */
	const blockedReason = $derived(
		invite.ineligibility === 'NOT_HACKER'
			? 'Teams are for hackers, and this account is registered under a different role.'
			: invite.ineligibility === 'NOT_CONFIRMED'
				? "Confirm your spot at the hackathon first — we'll keep this invitation for you."
				: null
	);

	/**
	 * Clear the server-side cookie as well as the local flag. Without it the banner is
	 * back on the next full page load, which is what this component exists to stop.
	 */
	async function forget() {
		try {
			await fetch('/hacker/invite', { method: 'DELETE' });
		} catch {
			// The banner is already gone from this session; a failed cleanup only means
			// it reappears on the next load, which is not worth an error message.
		}
	}

	async function handleJoin() {
		joining = true;
		joinError = null;
		try {
			await trpc.team.joinByCode.mutate({ inviteCode: invite.inviteCode });
			joined = true;
			await forget();
		} catch (e) {
			joinError = errorMessage(e, 'Failed to join team.');
		} finally {
			joining = false;
		}
	}

	async function handleDismiss() {
		dismissed = true;
		await forget();
	}
</script>

{#if !dismissed}
	<div class="mb-6 bg-card px-6 py-5 shadow-float">
		{#if joined}
			<p class="text-md font-medium break-words text-foreground">
				You joined <strong>{invite.teamName}</strong>.
				<a href={resolve('/hacker/account')} class="ml-1 font-medium text-brand-purple underline">
					Go to your account →
				</a>
			</p>
		{:else}
			<p class="mb-1 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
				Team invitation
			</p>
			<p class="mb-3 text-lg font-bold break-words text-foreground">
				Join <span class="font-bold">{invite.teamName}</span>
				<span class="ml-1 text-base font-normal text-foreground-secondary">
					({invite.memberCount}/{MAX_TEAM_SIZE} members)
				</span>
			</p>

			<!--
							Both of these used to be reasons the banner simply didn't render, which left the
							link looking broken. The invitation is kept either way, so a full team that
							frees a seat, or an RSVP that lands later, resolves itself with no second link.
						-->
			{#if full}
				<p class="mb-3 text-base text-foreground-secondary">
					This team is full. Ask them to free up a spot, or start your own team from your account
					page.
				</p>
			{:else if blockedReason}
				<p class="mb-3 text-base text-foreground-secondary">{blockedReason}</p>
			{/if}

			{#if joinError}
				<p class="mb-3 text-base text-destructive" role="alert">{joinError}</p>
			{/if}

			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={handleJoin}
					disabled={joining || full || invite.ineligibility !== null}
					class="cursor-pointer bg-brand-purple px-5 py-2.5 font-display text-md font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-40"
				>
					{joining ? 'Joining…' : 'Join team'}
				</button>
				<button
					type="button"
					onclick={handleDismiss}
					class="cursor-pointer border border-border px-5 py-2.5 font-display text-md font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring"
				>
					Dismiss
				</button>
			</div>
		{/if}
	</div>
{/if}
