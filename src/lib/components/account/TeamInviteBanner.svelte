<script lang="ts">
	import { resolve } from '$app/paths';
	import { createClient } from '$lib/trpc/client';
	import { errorMessage } from '$lib/ui/errors';
	import type { TeamIneligibility } from '$lib/team/eligibility';

	/**
	 * The pending team invitation, rendered above every page of the hacker portal.
	 *
	 * Mounted from `hacker/+layout.svelte` rather than from a page, which is the whole
	 * point: the layout survives client-side navigation, so dismissing it is a decision
	 * the hacker makes once instead of one the router makes for them every time they
	 * click Account.
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
	 * answers "why were you refused" after the fact. Here nothing has been attempted
	 * yet, and the two cases want opposite tones: a pending RSVP is a next step, a
	 * non-hacker account is a dead end and should not read like one more form to fill.
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
	 * back on the next full page load, which is exactly the behaviour this component
	 * was built to stop — just inverted.
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
	<div class="mb-6 rounded border border-border bg-white p-5">
		{#if joined}
			<p class="text-sm font-medium break-words text-primary">
				You joined <strong>{invite.teamName}</strong>.
				<a href={resolve('/hacker/account')} class="ml-1 text-muted-foreground underline">
					Go to your account →
				</a>
			</p>
		{:else}
			<p class="mb-0.5 text-xs font-medium tracking-widest text-muted-foreground uppercase">
				Team Invitation
			</p>
			<p class="mb-3 text-base font-semibold break-words text-primary">
				Join <span class="font-bold">{invite.teamName}</span>
				<span class="ml-1 text-sm font-normal text-muted-foreground">
					({invite.memberCount}/{MAX_TEAM_SIZE} members)
				</span>
			</p>

			<!--
				Both of these used to be reasons the banner simply didn't render, which
				left the link looking broken. Saying why is the fix; the invitation is
				kept either way, so a full team that frees a seat, or an RSVP that lands
				later, resolves itself with no second link.
			-->
			{#if full}
				<p class="mb-3 text-sm text-muted-foreground">
					This team is full. Ask them to free up a spot, or start your own team from your account
					page.
				</p>
			{:else if blockedReason}
				<p class="mb-3 text-sm text-muted-foreground">{blockedReason}</p>
			{/if}

			{#if joinError}
				<p class="mb-3 text-sm text-destructive" role="alert">{joinError}</p>
			{/if}

			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={handleJoin}
					disabled={joining || full || invite.ineligibility !== null}
					class="rounded bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
				>
					{joining ? 'Joining…' : 'Join team'}
				</button>
				<button
					type="button"
					onclick={handleDismiss}
					class="rounded border border-border px-4 py-2 text-sm text-primary transition-colors hover:bg-[--color-muted]"
				>
					Dismiss
				</button>
			</div>
		{/if}
	</div>
{/if}
