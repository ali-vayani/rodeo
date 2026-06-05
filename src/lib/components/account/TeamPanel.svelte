<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import type { Role } from '$lib/generated/prisma/enums';

	type Member = {
		uid: string;
		name: string;
		email: string;
		roles: Role[];
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

	// --- Create team ---
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
			createError = e instanceof Error ? e.message : 'Failed to create team.';
		} finally {
			creating = false;
		}
	}

	// --- Invite member ---
	let inviteEmail = $state('');
	let inviting = $state(false);
	let inviteError = $state<string | null>(null);
	let inviteSuccess = $state<string | null>(null);

	async function inviteMember() {
		if (!inviteEmail.trim()) return;
		inviting = true;
		inviteError = null;
		inviteSuccess = null;
		try {
			await trpc.team.inviteMember.mutate({ email: inviteEmail.trim() });
			inviteSuccess = `Invitation sent to ${inviteEmail.trim()}`;
			inviteEmail = '';
			await refresh();
		} catch (e) {
			inviteError = e instanceof Error ? e.message : 'Failed to send invitation.';
		} finally {
			inviting = false;
		}
	}

	// --- Accept / decline received invitations ---
	let respondingTo = $state<string | null>(null);
	let respondError = $state<string | null>(null);

	async function acceptInvite(id: string) {
		respondingTo = id;
		respondError = null;
		try {
			await trpc.team.acceptInvite.mutate({ invitationId: id });
			await refresh();
		} catch (e) {
			respondError = e instanceof Error ? e.message : 'Failed to accept invite.';
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
			respondError = e instanceof Error ? e.message : 'Failed to decline invite.';
		} finally {
			respondingTo = null;
		}
	}

	// --- Leave team ---
	let showLeaveConfirm = $state(false);
	let leaving = $state(false);

	async function leaveTeam() {
		leaving = true;
		try {
			await trpc.team.leaveTeam.mutate();
			showLeaveConfirm = false;
			await refresh();
		} catch {
			// state stays unchanged
		} finally {
			leaving = false;
		}
	}

	// --- Invite link ---
	let linkCopied = $state(false);

	function copyInviteLink() {
		if (!team) return;
		const url = `${window.location.origin}/hacker/application?join=${team.inviteCode}`;
		navigator.clipboard.writeText(url).then(() => {
			linkCopied = true;
			setTimeout(() => (linkCopied = false), 2000);
		});
	}

	// --- Helpers ---
	function initials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		return name.slice(0, 2).toUpperCase();
	}

	const memberCount = $derived(team?.members.length ?? 0);
	const teamFull = $derived(memberCount >= 4);
</script>

<div class="rounded border border-border bg-white p-6">
	<p class="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">TEAM</p>

	{#if team}
		<!-- Team name -->
		<p class="mb-4 text-sm font-semibold text-primary">{team.teamName}</p>

		<!-- Member list -->
		<div class="mb-4 flex flex-col gap-3">
			{#each team.members as member (member.uid)}
				<div class="flex items-center gap-3">
					<!-- Avatar -->
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center text-xs font-semibold {member.uid === uid ? 'bg-primary text-white' : 'bg-muted text-primary border border-border'}"
					>
						{initials(member.name)}
					</div>
					<!-- Name + email -->
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium text-primary">
							{member.name}
							{#if member.uid === uid}
								<span class="ml-1 text-xs font-normal text-muted-foreground">(you)</span>
							{/if}
						</p>
						<p class="truncate text-xs text-muted-foreground">{member.email}</p>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pending outgoing invitations -->
		{#if team.invitations.length > 0}
			<div class="mb-4 border-t border-border pt-4">
				<p class="mb-2 text-xs text-muted-foreground">Pending invitations</p>
				{#each team.invitations as inv (inv.id)}
					<div class="flex items-center gap-2 py-1">
						<div
							class="flex h-6 w-6 shrink-0 items-center justify-center text-[10px] font-semibold bg-muted text-muted-foreground border border-border"
						>
							{inv.user ? initials(inv.user.name) : '?'}
						</div>
						<span class="truncate text-xs text-muted-foreground">{inv.email}</span>
						<span
							class="ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] bg-muted text-muted-foreground"
						>
							invited
						</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Member count + invite form -->
		<div class="border-t border-border pt-4">
			<p class="mb-3 text-xs text-muted-foreground">
				{memberCount}/4 members · Invite by email
			</p>

			{#if !teamFull}
				<div class="flex gap-2">
					<input
						type="email"
						bind:value={inviteEmail}
						placeholder="teammate@example.com"
						onkeydown={(e) => e.key === 'Enter' && inviteMember()}
						class="min-w-0 flex-1 rounded border border-border px-3 py-1.5 text-sm text-primary outline-none focus:ring-1 focus:ring-primary"
					/>
					<button
						type="button"
						onclick={inviteMember}
						disabled={inviting || !inviteEmail.trim()}
						class="rounded px-4 py-1.5 text-sm font-medium bg-primary text-white transition-opacity disabled:opacity-40"
					>
						{inviting ? '…' : 'Add'}
					</button>
				</div>

				{#if inviteError}
					<p class="mt-2 text-xs text-destructive">{inviteError}</p>
				{/if}
				{#if inviteSuccess}
					<p class="mt-2 text-xs text-primary">{inviteSuccess}</p>
				{/if}
			{:else}
				<p class="text-xs text-muted-foreground">Team is full (max 4).</p>
			{/if}
		</div>

		<!-- Invite link -->
		{#if team.inviteCode}
			<div class="mt-4 border-t border-border pt-4">
				<p class="mb-2 text-xs text-muted-foreground">Or share an invite link</p>
				<button
					type="button"
					onclick={copyInviteLink}
					class="w-full rounded border border-border px-3 py-1.5 text-left text-xs text-primary font-mono transition-colors hover:bg-[#f4f4f4]"
				>
					{linkCopied ? '✓ Copied!' : 'Copy invite link'}
				</button>
			</div>
		{/if}

		<!-- Leave team -->
		<div class="mt-4 border-t border-border pt-4">
			{#if showLeaveConfirm}
				<p class="mb-2 text-xs text-primary">
					Are you sure you want to leave <strong>{team.teamName}</strong>?
					{#if memberCount === 1}
						The team will be deleted.
					{/if}
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={leaveTeam}
						disabled={leaving}
						class="rounded px-3 py-1.5 text-xs font-medium bg-destructive text-white transition-opacity disabled:opacity-40"
					>
						{leaving ? 'Leaving…' : 'Yes, leave'}
					</button>
					<button
						type="button"
						onclick={() => (showLeaveConfirm = false)}
						class="rounded border border-border px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[#f4f4f4]"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => (showLeaveConfirm = true)}
					class="text-xs text-muted-foreground transition-colors hover:underline"
				>
					Leave team
				</button>
			{/if}
		</div>
	{:else}
		<!-- No team -->
		{#if pendingInvitations.length === 0}
			<!-- No team, no invitations -->
			{#if showCreateForm}
				<div class="flex flex-col gap-3">
					<input
						type="text"
						bind:value={teamNameInput}
						placeholder="Team name"
						onkeydown={(e) => e.key === 'Enter' && createTeam()}
						class="rounded border border-border px-3 py-2 text-sm text-primary outline-none focus:ring-1 focus:ring-primary"
					/>
					{#if createError}
						<p class="text-xs text-destructive">{createError}</p>
					{/if}
					<div class="flex gap-2">
						<button
							type="button"
							onclick={createTeam}
							disabled={creating || !teamNameInput.trim()}
							class="rounded px-4 py-2 text-sm font-medium bg-primary text-white transition-opacity disabled:opacity-40"
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
							class="rounded border border-border px-4 py-2 text-sm text-primary transition-colors hover:bg-[#f4f4f4]"
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
					class="rounded px-4 py-2 text-sm font-medium bg-primary text-white"
				>
					Create team
				</button>
			{/if}
		{/if}
	{/if}

	<!-- Pending received invitations -->
	{#if pendingInvitations.length > 0}
		<div class={team ? 'mt-5 border-t border-border pt-4' : ''}>
			<p class="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
				Team Invitations
			</p>
			{#if respondError}
				<p class="mb-2 text-xs text-destructive">{respondError}</p>
			{/if}
			{#each pendingInvitations as inv (inv.id)}
				<div
					class="mb-3 rounded border border-border bg-muted p-3 last:mb-0"
				>
					<p class="mb-0.5 text-sm font-medium text-primary">{inv.team.teamName}</p>
					<p class="mb-3 text-xs text-muted-foreground">
						{inv.team.members.length} member{inv.team.members.length === 1 ? '' : 's'} ·
						{inv.team.members.map((m) => m.name.split(' ')[0]).join(', ')}
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => acceptInvite(inv.id)}
							disabled={respondingTo === inv.id}
							class="rounded px-3 py-1.5 text-xs font-medium bg-primary text-white transition-opacity disabled:opacity-40"
						>
							{respondingTo === inv.id ? '…' : 'Accept'}
						</button>
						<button
							type="button"
							onclick={() => declineInvite(inv.id)}
							disabled={respondingTo === inv.id}
							class="rounded border border-border px-3 py-1.5 text-xs text-primary transition-colors hover:bg-white disabled:opacity-40"
						>
							Decline
						</button>
					</div>
				</div>
			{/each}

			{#if !team && pendingInvitations.length > 0}
				<div class="mt-4 border-t border-border pt-4">
					{#if showCreateForm}
						<p class="mb-2 text-xs font-medium text-primary">Create your own team instead:</p>
						<div class="flex flex-col gap-2">
							<input
								type="text"
								bind:value={teamNameInput}
								placeholder="Team name"
								onkeydown={(e) => e.key === 'Enter' && createTeam()}
								class="rounded border border-border px-3 py-2 text-sm text-primary outline-none"
							/>
							{#if createError}
								<p class="text-xs text-destructive">{createError}</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									onclick={createTeam}
									disabled={creating || !teamNameInput.trim()}
									class="rounded px-4 py-1.5 text-xs font-medium bg-primary text-white transition-opacity disabled:opacity-40"
								>
									{creating ? 'Creating…' : 'Create team'}
								</button>
								<button
									type="button"
									onclick={() => {
										showCreateForm = false;
										createError = null;
									}}
									class="rounded border border-border px-4 py-1.5 text-xs text-primary transition-colors hover:bg-[#f4f4f4]"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (showCreateForm = true)}
							class="text-xs text-muted-foreground transition-colors hover:underline"
						>
							Or create your own team instead
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
