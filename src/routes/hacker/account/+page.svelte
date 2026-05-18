<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import { getApplicationStateLabel } from '$lib/application/state';
	import type { Role } from '$lib/generated/prisma/enums';
	import QRCard from '$lib/components/account/QRCard.svelte';
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

	const APPLICATION_ROLES: Role[] = ['HACKER', 'JUDGE', 'MENTOR', 'VOLUNTEER'];

	const primaryRole = user.roles.find((r) => APPLICATION_ROLES.includes(r as Role)) ?? user.roles[0];

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

	const checkedIn = $derived(user.status === UserStatus.CHECKED_IN);
	const twoColumn = $derived(showRsvp || showEventContent);

	const { rsvping, handleRsvp } = createRsvpHandler({ user });
	const { declining, handleDecline } = createDeclineHandler({ user });

	function statusStyle(label: string): string {
		if (label === 'Confirmed' || label === 'Checked In') return 'background: #191919; color: #fff;';
		if (label === 'Accepted') return 'background: #f4f4f4; color: #191919; border: 1px solid #191919;';
		return 'background: #f4f4f4; color: #aaaaaa;';
	}
</script>

<div>
	<div class="mb-6">
		<h1 class="text-2xl font-semibold" style="color: #191919">My Account</h1>
	</div>

	<div class="grid grid-cols-1 gap-4 {twoColumn ? 'lg:grid-cols-2' : 'max-w-md'}">
		<!-- Left column: profile + QR (QR only when confirmed/checked in) -->
		<div class="flex flex-col gap-4">
			<div class="rounded border bg-white p-6" style="border-color: #e0e0e0">
				<p class="mb-4 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
					PROFILE
				</p>

				<div class="mb-5 flex items-start gap-4">
					<div
						class="flex h-14 w-14 shrink-0 items-center justify-center text-base font-semibold"
						style="background: #191919; color: #fff"
					>
						{initials(user.name)}
					</div>
					<div>
						<p class="text-base font-bold leading-tight" style="color: #191919">{user.name}</p>
						<p class="mb-2 text-xs" style="color: #aaaaaa">{user.email}</p>
						{#if primaryRole}
							<span
								class="rounded border px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide"
								style="border-color: #191919; color: #191919"
							>
								{primaryRole}
							</span>
						{/if}
					</div>
				</div>

				<div class="border-t" style="border-color: #e0e0e0">
					{#if user.university}
						<div
							class="flex justify-between border-b py-2.5 text-sm"
							style="border-color: #e0e0e0"
						>
							<span style="color: #aaaaaa">School</span>
							<span class="font-medium" style="color: #191919">{user.university}</span>
						</div>
					{/if}
					{#if user.year}
						<div
							class="flex justify-between border-b py-2.5 text-sm"
							style="border-color: #e0e0e0"
						>
							<span style="color: #aaaaaa">Grad Year</span>
							<span class="font-medium" style="color: #191919">{user.year}</span>
						</div>
					{/if}
					{#if decisionLabel}
						<div
							class="flex justify-between py-2.5 text-sm"
							style="border-color: #e0e0e0"
						>
							<span style="color: #aaaaaa">Status</span>
							<span
								class="rounded px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide"
								style={statusStyle(decisionLabel)}
							>
								{decisionLabel}
							</span>
						</div>
					{/if}
				</div>
			</div>

			{#if showEventContent}
				<QRCard uid={user.uid} />
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
		{:else if showEventContent}
			<TeamPanel
				uid={user.uid}
				initialTeam={user.team}
				initialPendingInvitations={user.invitations}
			/>
		{/if}
	</div>
</div>
