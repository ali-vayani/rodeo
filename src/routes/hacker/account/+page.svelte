<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import { getApplicationStateLabel } from '$lib/application/state';
	import { Role } from '$lib/generated/prisma/enums';
	import QRCard from '$lib/components/account/QRCard.svelte';
	import WalletPassCard from '$lib/components/account/WalletPassCard.svelte';
	import TeamPanel from '$lib/components/account/TeamPanel.svelte';
	import ApplicationStateView from '$lib/components/application/ApplicationStateView.svelte';
	import { createRsvpHandler } from '$lib/application/rsvp.svelte';
	import { createDeclineHandler } from '$lib/application/decline.svelte';

	let { data }: { data: PageData } = $props();

	const { user: initialUser, settings } = untrack(() => data);
	let user = $state({ ...initialUser });

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		return name.slice(0, 2).toUpperCase();
	}

	const decisionLabel = $derived(getApplicationStateLabel(user));

	const showRsvp = $derived(
		user.activeDecision === DecisionStatus.ACCEPTED &&
			user.status !== UserStatus.CONFIRMED &&
			user.status !== UserStatus.CHECKED_IN &&
			user.status !== UserStatus.DECLINED
	);

	const showEventContent = $derived(
		user.status === UserStatus.CONFIRMED || user.status === UserStatus.CHECKED_IN
	);

	const twoColumn = $derived(showRsvp || showEventContent);

	const { rsvping, handleRsvp } = createRsvpHandler({ user });
	const { declining, handleDecline } = createDeclineHandler({ user });

	function statusClass(label: string): string {
		if (label === 'Confirmed' || label === 'Checked In') return 'bg-primary text-white';
		if (label === 'Accepted') return 'bg-muted text-primary border border-primary';
		return 'bg-muted text-muted-foreground';
	}
</script>

<div>
	<div class="mb-6">
		<h1 class="text-2xl font-semibold text-primary">My Account</h1>
	</div>

	<div class="grid grid-cols-1 gap-4 {twoColumn ? 'lg:grid-cols-2' : 'max-w-md'}">
		<!-- Left column: profile + QR (QR only when confirmed/checked in) -->
		<div class="flex flex-col gap-4">
			<div class="rounded border border-border bg-white p-6">
				<p class="mb-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">
					PROFILE
				</p>

				<div class="mb-5 flex items-start gap-4">
					<div
						class="flex h-14 w-14 shrink-0 items-center justify-center bg-primary text-base font-semibold text-white"
					>
						{initials(user.name)}
					</div>
					<div class="min-w-0">
						<p class="text-base leading-tight font-bold break-words text-primary">{user.name}</p>
						<p class="mb-2 text-xs break-words text-muted-foreground">{user.email}</p>
						<span
							class="rounded border border-primary px-2 py-0.5 font-mono text-xs font-medium tracking-wide text-primary uppercase"
						>
							{user.role}
						</span>
					</div>
				</div>

				<div class="border-t border-border">
					{#if user.university}
						<div class="flex justify-between gap-3 border-b border-border py-2.5 text-sm">
							<span class="shrink-0 text-muted-foreground">School</span>
							<span class="min-w-0 text-right font-medium break-words text-primary"
								>{user.university}</span
							>
						</div>
					{/if}
					{#if user.year}
						<div class="flex justify-between gap-3 border-b border-border py-2.5 text-sm">
							<span class="shrink-0 text-muted-foreground">Grad Year</span>
							<span class="min-w-0 text-right font-medium break-words text-primary"
								>{user.year}</span
							>
						</div>
					{/if}
					{#if decisionLabel}
						<div class="flex justify-between py-2.5 text-sm">
							<span class="text-muted-foreground">Status</span>
							<span
								class="rounded px-2 py-0.5 font-mono text-xs font-semibold tracking-wide uppercase {statusClass(
									decisionLabel
								)}"
							>
								{decisionLabel}
							</span>
						</div>
					{/if}
				</div>
			</div>

			{#if showEventContent}
				<QRCard uid={user.uid} />
				<!-- Below the QR, not inside it: QRCard is the fallback for anyone
				     without a smartphone wallet and stays single-purpose. -->
				<WalletPassCard availability={data.wallet} rsvpDeadline={settings?.RSVPDeadline} />
			{/if}
		</div>

		{#if showRsvp}
			<ApplicationStateView
				{user}
				{settings}
				onrsvp={handleRsvp}
				{rsvping}
				ondecline={handleDecline}
				{declining}
			/>
		{:else if showEventContent && user.role === Role.HACKER}
			<TeamPanel
				uid={user.uid}
				initialTeam={user.team}
				initialPendingInvitations={user.invitations}
			/>
		{/if}
	</div>
</div>
