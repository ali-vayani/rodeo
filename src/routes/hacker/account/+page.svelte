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

	/** Which status ramp a decision label reads on. Accepted and beyond are good news. */
	function statusTone(label: string): string {
		if (label === 'Confirmed' || label === 'Checked In' || label === 'Accepted')
			return 'bg-success-50 text-success-700';
		if (label === 'Waitlisted') return 'bg-warning-50 text-warning-700';
		if (label === 'Rejected' || label === 'Declined') return 'bg-danger-50 text-danger-700';
		return 'bg-muted text-brand-purple';
	}
</script>

<div>
	<header class="mb-6">
		<h1 class="font-display text-display font-extrabold tracking-wide text-white uppercase">
			Account
		</h1>
		<p class="mt-1 text-md text-white/80">
			Your profile{showEventContent ? ', your check-in code, and your team' : ''}.
		</p>
	</header>

	<div class="grid grid-cols-1 gap-5 {twoColumn ? 'lg:grid-cols-2' : 'max-w-lg'}">
		<div class="flex flex-col gap-5">
			<div class=" bg-card shadow-float">
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line-subtle
					 px-6 py-4"
				>
					<h2 class="text-lg font-bold text-foreground">Profile</h2>
					{#if decisionLabel}
						<span
							class=" px-2.5 py-1 font-mono text-2xs font-medium tracking-eyebrow
							 uppercase {statusTone(decisionLabel)}"
						>
							{decisionLabel}
						</span>
					{/if}
				</div>

				<div class="px-6 py-6">
					<!--
						No avatar. There is no photo to show and initials in a tinted square were
						decoration standing in for information — the name is the identity here.
					-->
					<div class="mb-5 min-w-0">
						<p class="text-2xl leading-tight font-extrabold break-words text-foreground">
							{user.name}
						</p>
						<p class="mt-1 text-base break-words text-foreground-secondary">{user.email}</p>
					</div>

					<dl class="border-t border-brand-line-subtle">
						<div
							class="flex justify-between gap-3 border-b border-brand-line-subtle py-2.5 text-base"
						>
							<dt class="shrink-0 text-foreground-secondary">Role</dt>
							<dd class="m-0 text-right font-semibold text-foreground">{user.role}</dd>
						</div>
						{#if user.university}
							<div
								class="flex justify-between gap-3 border-b border-brand-line-subtle py-2.5 text-base"
							>
								<dt class="shrink-0 text-foreground-secondary">School</dt>
								<dd class="m-0 min-w-0 text-right font-semibold break-words text-foreground">
									{user.university}
								</dd>
							</div>
						{/if}
						{#if user.year}
							<div class="flex justify-between gap-3 py-2.5 text-base">
								<dt class="shrink-0 text-foreground-secondary">Grad year</dt>
								<dd class="m-0 text-right font-semibold text-foreground">{user.year}</dd>
							</div>
						{/if}
					</dl>
				</div>
			</div>

			{#if showEventContent}
				<QRCard uid={user.uid} />
				<!-- Below the QR, not inside it: QRCard is the fallback for anyone
				 without a smartphone wallet and stays single-purpose. -->
				<WalletPassCard
					availability={data.wallet}
					rsvpDeadline={settings?.RSVPDeadline}
					eventStart={settings?.hackathonStartDate}
				/>
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
