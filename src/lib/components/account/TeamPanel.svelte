<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { createClient } from '$lib/trpc/client';
	import { errorMessage } from '$lib/ui/errors';
	import type { Role } from '$lib/generated/prisma/enums';

	type Member = {
		uid: string;
		name: string;
		email: string;
		role: Role;
	};

	type TeamData = {
		id: string;
		teamName: string;
		inviteCode: string;
		members: Member[];
		invitations: { id: string; email: string; user: Member | null }[];
	};

	type ReceivedInvitation = {
		id: string;
		team: { id: string; teamName: string; members: Member[] };
		email: string;
	};

	interface Props {
		uid: string;
		initialTeam: TeamData | null;
		initialPendingInvitations: ReceivedInvitation[];
	}

	let { uid, initialTeam, initialPendingInvitations }: Props = $props();

	const trpc = createClient();

	let team = $state<TeamData | null>(untrack(() => initialTeam));
	let pendingInvitations = $state<ReceivedInvitation[]>(untrack(() => initialPendingInvitations));

	async function refresh() {
		const result = await trpc.team.getMyTeam.query();
		team = result.team as TeamData | null;
		pendingInvitations = result.pendingInvitations as ReceivedInvitation[];
	}

	let teamNameInput = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let showCreateForm = $state(false);

	async function createTeam() {
		if (!teamNameInput.trim()) return;
		creating = true;
		createError = null;
		try {
			await trpc.team.createTeam.mutate({ teamName: teamNameInput.trim() });
			teamNameInput = '';
			showCreateForm = false;
			await refresh();
		} catch (e) {
			createError = errorMessage(e, 'Failed to create team.');
		} finally {
			creating = false;
		}
	}

	let inviteEmail = $state('');
	let inviting = $state(false);
	let inviteError = $state<string | null>(null);
	let inviteSuccess = $state<string | null>(null);

	/**
	 * Checked on submit only, never while typing.
	 *
	 * Every address is malformed halfway through being typed, so a live check spends most
	 * of its time calling a half-finished address wrong.
	 *
	 * Deliberately loose: one @, something either side, a dot in the domain. The server's
	 * zod schema is the authority, and a stricter pattern here would only invent
	 * rejections the server would have accepted.
	 */
	const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	async function inviteMember() {
		const email = inviteEmail.trim();
		if (!email) return;

		inviteSuccess = null;
		if (!EMAIL_PATTERN.test(email)) {
			inviteError = `"${email}" is not a valid email address. Use the address they signed up with, like teammate@example.com.`;
			return;
		}

		inviting = true;
		inviteError = null;
		try {
			await trpc.team.inviteMember.mutate({ email });
			inviteSuccess = `Invitation sent to ${email}`;
			inviteEmail = '';
			await refresh();
		} catch (e) {
			inviteError = errorMessage(e, 'Failed to send invitation.');
		} finally {
			inviting = false;
		}
	}

	let respondingTo = $state<string | null>(null);
	let respondError = $state<string | null>(null);

	async function acceptInvite(id: string) {
		respondingTo = id;
		respondError = null;
		try {
			await trpc.team.acceptInvite.mutate({ invitationId: id });
			await refresh();
		} catch (e) {
			respondError = errorMessage(e, 'Failed to accept invite.');
		} finally {
			respondingTo = null;
		}
	}

	async function declineInvite(id: string) {
		respondingTo = id;
		respondError = null;
		try {
			await trpc.team.declineInvite.mutate({ invitationId: id });
			await refresh();
		} catch (e) {
			respondError = errorMessage(e, 'Failed to decline invite.');
		} finally {
			respondingTo = null;
		}
	}

	let showLeaveConfirm = $state(false);
	let leaving = $state(false);
	let leaveError = $state<string | null>(null);

	async function leaveTeam() {
		leaving = true;
		leaveError = null;
		try {
			await trpc.team.leaveTeam.mutate();
			showLeaveConfirm = false;
			// Clear the stale invite/create forms along with the team, so the panel that
			// comes back is the one a teamless account should see.
			inviteEmail = '';
			inviteError = null;
			inviteSuccess = null;
			await refresh();
			// The invite banner is rendered from the hacker layout's own load, which does not
			// re-run for a mutation. Without this it keeps describing an account still on a team.
			await invalidateAll();
		} catch (e) {
			leaveError = errorMessage(e, 'Failed to leave team.');
		} finally {
			leaving = false;
		}
	}

	let linkCopied = $state(false);

	function copyInviteLink() {
		if (!team) return;
		const url = `${window.location.origin}/hacker/application?join=${team.inviteCode}`;
		navigator.clipboard.writeText(url).then(() => {
			linkCopied = true;
			setTimeout(() => (linkCopied = false), 2000);
		});
	}

	const memberCount = $derived(team?.members.length ?? 0);
	const teamFull = $derived(memberCount >= 4);
</script>

<div class=" bg-card px-6 py-6 shadow-float">
	<h2 class="mb-4 text-lg font-bold text-foreground">Your team</h2>

	{#if team}
		<p class="mb-4 text-md font-semibold break-words text-foreground">{team.teamName}</p>

		<div class="mb-4 flex flex-col gap-3">
			{#each team.members as member (member.uid)}
				<!--
					A rule down the left instead of an initials tile: it marks the row as
					yours without pretending to be a profile picture.
				-->
				<div
					class="min-w-0 border-l-2 pl-3 {member.uid === uid
						? 'border-brand-purple'
						: 'border-brand-line'}"
				>
					<p class="truncate text-base font-semibold text-foreground">
						{member.name}
						{#if member.uid === uid}
							<span class="ml-1 text-xs font-normal text-muted-foreground">(you)</span>
						{/if}
					</p>
					<p class="truncate text-xs text-muted-foreground">{member.email}</p>
				</div>
			{/each}
		</div>

		{#if team.invitations.length > 0}
			<div class="mb-4 border-t border-brand-line-subtle pt-4">
				<p class="mb-2 text-xs text-muted-foreground">Pending invitations</p>
				{#each team.invitations as inv (inv.id)}
					<div class="flex items-center gap-2 py-1">
						<span
							class="truncate border-l-2 border-dashed border-brand-line pl-3 text-xs
							text-muted-foreground">{inv.email}</span
						>
						<span
							class="ml-auto shrink-0 bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground-tertiary"
						>
							invited
						</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="border-t border-brand-line-subtle pt-4">
			<p class="mb-3 text-xs text-muted-foreground">
				{memberCount}/4 members · Invite by email
			</p>

			{#if !teamFull}
				<div class="flex gap-2">
					<input
						type="email"
						bind:value={inviteEmail}
						placeholder="teammate@example.com"
						aria-describedby="invite-email-message"
						onkeydown={(e) => e.key === 'Enter' && inviteMember()}
						class="min-w-0 flex-1 border border-border px-3 py-2 text-base text-foreground transition-colors duration-150 outline-none focus:border-brand-purple focus-visible:shadow-ring"
					/>
					<button
						type="button"
						onclick={inviteMember}
						disabled={inviting || !inviteEmail.trim()}
						class="cursor-pointer bg-brand-purple px-4 py-2 font-display text-base font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:opacity-40"
					>
						{inviting ? '…' : 'Add'}
					</button>
				</div>

				<!-- One slot, so a stale success line can't sit under a fresh error. -->
				<div id="invite-email-message" aria-live="polite">
					{#if inviteError}
						<p class="mt-2 text-xs break-words text-destructive">{inviteError}</p>
					{:else if inviteSuccess}
						<p class="mt-2 text-xs break-words text-success-700">{inviteSuccess}</p>
					{/if}
				</div>
			{:else}
				<p class="text-xs text-muted-foreground">Team is full (max 4).</p>
			{/if}
		</div>

		{#if team.inviteCode}
			<div class="mt-4 border-t border-brand-line-subtle pt-4">
				<p class="mb-2 text-xs text-muted-foreground">Or share an invite link</p>
				<button
					type="button"
					onclick={copyInviteLink}
					class="w-full cursor-pointer border border-border px-3 py-2 text-left font-mono text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring"
				>
					{linkCopied ? '✓ Copied!' : 'Copy invite link'}
				</button>
			</div>
		{/if}

		<div class="mt-4 border-t border-brand-line-subtle pt-4">
			{#if showLeaveConfirm}
				<p class="mb-2 text-xs break-words text-foreground">
					Are you sure you want to leave <strong>{team.teamName}</strong>?
					{#if memberCount === 1}
						The team will be deleted.
					{/if}
				</p>
				{#if leaveError}
					<p class="mb-2 text-xs text-destructive">{leaveError}</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						onclick={leaveTeam}
						disabled={leaving}
						class="cursor-pointer bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground transition-colors duration-150 hover:bg-destructive-hover focus-visible:shadow-ring-danger disabled:opacity-40"
					>
						{leaving ? 'Leaving…' : 'Yes, leave'}
					</button>
					<button
						type="button"
						onclick={() => (showLeaveConfirm = false)}
						class="cursor-pointer border border-border px-3 py-2 text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => (showLeaveConfirm = true)}
					class="cursor-pointer text-xs text-foreground-tertiary transition-colors hover:text-foreground hover:underline"
				>
					Leave team
				</button>
			{/if}
		</div>
	{:else if pendingInvitations.length === 0}
		{#if showCreateForm}
			<div class="flex flex-col gap-3">
				<input
					type="text"
					bind:value={teamNameInput}
					placeholder="Team name"
					onkeydown={(e) => e.key === 'Enter' && createTeam()}
					class=" border border-border px-3.5 py-2.5 text-base text-foreground transition-colors duration-150 outline-none focus:border-brand-purple focus-visible:shadow-ring"
				/>
				{#if createError}
					<p class="text-xs text-destructive">{createError}</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						onclick={createTeam}
						disabled={creating || !teamNameInput.trim()}
						class="cursor-pointer bg-brand-purple px-4 py-2.5 font-display text-md font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:opacity-40"
					>
						{creating ? 'Creating…' : 'Create team'}
					</button>
					<button
						type="button"
						onclick={() => {
							showCreateForm = false;
							createError = null;
							teamNameInput = '';
						}}
						class="cursor-pointer border border-border px-4 py-2.5 font-display text-md font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring disabled:opacity-40"
					>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<p class="mb-4 text-sm leading-relaxed text-muted-foreground">
				You're not on a team yet. Create one and invite your teammates.
			</p>
			<button
				type="button"
				onclick={() => (showCreateForm = true)}
				class="cursor-pointer bg-brand-purple px-4 py-2.5 font-display text-md font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:opacity-40"
			>
				Create team
			</button>
		{/if}
	{/if}

	{#if pendingInvitations.length > 0}
		<div class={team ? 'mt-5 border-t border-brand-line-subtle pt-4' : ''}>
			<p class="mb-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">
				Team Invitations
			</p>
			{#if respondError}
				<p class="mb-2 text-xs text-destructive">{respondError}</p>
			{/if}
			{#each pendingInvitations as inv (inv.id)}
				<div class="mb-3 bg-muted p-4 last:mb-0">
					<p class="mb-0.5 text-base font-semibold text-foreground">{inv.team.teamName}</p>
					<p class="mb-3 text-xs text-muted-foreground">
						{inv.team.members.length} member{inv.team.members.length === 1 ? '' : 's'} ·
						{inv.team.members.map((m) => m.name.split('')[0]).join(',')}
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => acceptInvite(inv.id)}
							disabled={respondingTo === inv.id}
							class="cursor-pointer bg-brand-purple px-3 py-2 font-display text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:opacity-40"
						>
							{respondingTo === inv.id ? '…' : 'Accept'}
						</button>
						<button
							type="button"
							onclick={() => declineInvite(inv.id)}
							disabled={respondingTo === inv.id}
							class="cursor-pointer border border-border px-3 py-2 font-display text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring disabled:opacity-40"
						>
							Decline
						</button>
					</div>
				</div>
			{/each}

			{#if !team && pendingInvitations.length > 0}
				<div class="mt-4 border-t border-brand-line-subtle pt-4">
					{#if showCreateForm}
						<p class="mb-2 text-xs font-semibold text-foreground">Create your own team instead:</p>
						<div class="flex flex-col gap-2">
							<input
								type="text"
								bind:value={teamNameInput}
								placeholder="Team name"
								onkeydown={(e) => e.key === 'Enter' && createTeam()}
								class=" border border-border px-3.5 py-2.5 text-base text-foreground transition-colors duration-150 outline-none focus:border-brand-purple focus-visible:shadow-ring"
							/>
							{#if createError}
								<p class="text-xs text-destructive">{createError}</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									onclick={createTeam}
									disabled={creating || !teamNameInput.trim()}
									class="cursor-pointer bg-brand-purple px-4 py-2 font-display text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-purple-hover focus-visible:shadow-ring disabled:opacity-40"
								>
									{creating ? 'Creating…' : 'Create team'}
								</button>
								<button
									type="button"
									onclick={() => {
										showCreateForm = false;
										createError = null;
									}}
									class="cursor-pointer border border-border px-4 py-2 font-display text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:shadow-ring disabled:opacity-40"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (showCreateForm = true)}
							class="cursor-pointer text-xs text-foreground-tertiary transition-colors hover:text-foreground hover:underline"
						>
							Or create your own team instead
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
