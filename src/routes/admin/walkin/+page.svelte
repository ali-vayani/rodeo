<script lang="ts">
	import { untrack } from 'svelte';
	import { TriangleAlert, X } from 'lucide-svelte';
	import { createClient } from '$lib/trpc/client';
	import { isWalkInUnlocked } from '$lib/walkin/unlock';
	import { formatDateLong } from '$lib/format';
	import { errorMessage } from '$lib/ui/errors';
	import { UserStatus } from '$lib/generated/prisma/enums';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// Evaluated once per visit: the lock flips at midnight, not mid-session.
	const unlocked = untrack(() => isWalkInUnlocked(data.settings));
	const eventDay = untrack(() =>
		data.settings ? formatDateLong(data.settings.hackathonStartDate) : null
	);

	let invited = $state(untrack(() => [...data.invited]));
	let email = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let sentTo = $state<string | null>(null);

	const STATUS_LABELS: Record<UserStatus, string> = {
		CREATED: 'Needs application',
		APPLIED: 'Needs confirmation',
		CONFIRMED: 'Confirmed',
		DECLINED: 'Declined',
		CHECKED_IN: 'Checked in'
	};

	const STATUS_STYLES: Record<UserStatus, string> = {
		CREATED: 'bg-amber-50 text-amber-700 border-amber-200',
		APPLIED: 'bg-sky-50 text-sky-700 border-sky-200',
		CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		DECLINED: 'bg-red-50 text-red-700 border-red-200',
		CHECKED_IN: 'bg-emerald-600 text-white border-emerald-600'
	};

	async function invite(event: SubmitEvent) {
		event.preventDefault();
		if (!email.trim() || sending) return;

		sending = true;
		error = null;
		sentTo = null;
		try {
			const result = await trpc.walkin.invite.mutate({ email });
			sentTo = result.email;
			email = '';
			invited = await trpc.walkin.list.query();
		} catch (e) {
			error = errorMessage(e, 'Failed to send the invite');
		} finally {
			sending = false;
		}
	}

	let uninviting = $state<string | null>(null);

	// Revokes the invite only; a confirmed walk-in keeps their spot (that lever lives on
	// the Users page), which is why their row warns rather than silently disappearing.
	async function uninvite(person: { uid: string; email: string; status: UserStatus }) {
		if (uninviting) return;
		if (
			person.status === UserStatus.CONFIRMED &&
			!window.confirm(
				`${person.email} already confirmed their spot. Removing the invite will not ` +
					'un-confirm them — change their status on the Users page for that. Remove the invite?'
			)
		) {
			return;
		}

		uninviting = person.uid;
		error = null;
		try {
			await trpc.walkin.uninvite.mutate({ uid: person.uid });
			invited = invited.filter((p) => p.uid !== person.uid);
		} catch (e) {
			error = errorMessage(e, 'Failed to remove the invite');
		} finally {
			uninviting = null;
		}
	}

	function invitedAtLabel(value: Date | string | null): string {
		if (!value) return '';
		const date = new Date(value);
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Walk-In</h1>
</div>

{#if !unlocked}
	<p
		class="mb-4 flex items-center gap-2 rounded-md border border-border bg-white px-4 py-3 text-[13px] font-medium text-muted-foreground"
		role="status"
	>
		<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
		Walk-ins open on the day of the event{eventDay ? ` — ${eventDay}` : ''}. Everything below
		unlocks then.
	</p>
{/if}

<!-- Locked state greys the whole workflow rather than hiding it, so staff can see what
     the page will do before event day. The server enforces the same rule. -->
<div class={unlocked ? '' : 'pointer-events-none opacity-50'} aria-disabled={!unlocked}>
	<div class="mb-4 rounded-md border border-border bg-white p-4 md:p-6">
		<h2 class="text-[15px] font-semibold text-primary">Invite a walk-in</h2>
		<p class="mt-0.5 mb-3 text-xs text-muted-foreground">
			Sends the Walk-In Invite email with a link to the hacker portal. They sign in with this
			address, submit the walk-in application if they never applied, and confirm their spot.
			Inviting the same address again resends the email.
		</p>

		<form onsubmit={invite} class="flex flex-wrap items-center gap-2">
			<input
				type="email"
				bind:value={email}
				required
				disabled={!unlocked || sending}
				placeholder="hacker@example.com"
				class="w-full max-w-sm rounded-md border border-border px-3 py-[9px] text-[13px] text-primary outline-none focus:border-primary disabled:bg-muted"
			/>
			<button
				type="submit"
				disabled={!unlocked || sending || !email.trim()}
				class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
			>
				{sending ? 'Sending…' : 'Send Invite'}
			</button>
		</form>

		{#if error}
			<p class="mt-2 text-[13px] text-destructive" role="alert">{error}</p>
		{:else if sentTo}
			<p class="mt-2 text-[13px] text-emerald-700" role="status">Invite sent to {sentTo}.</p>
		{/if}
	</div>

	<div class="rounded-md border border-border bg-white">
		<div class="flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
			<h2 class="text-[15px] font-semibold text-primary">Invited walk-ins</h2>
			<span class="text-xs text-muted-foreground">{invited.length} invited</span>
		</div>

		{#if invited.length === 0}
			<p class="px-4 py-6 text-[13px] text-muted-foreground md:px-6">
				Nobody has been invited yet.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-[13px]">
					<thead>
						<tr
							class="border-b border-border text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
						>
							<th class="px-4 py-2.5 md:px-6">Email</th>
							<th class="px-4 py-2.5">Name</th>
							<th class="px-4 py-2.5">Status</th>
							<th class="px-4 py-2.5">Invited</th>
							<th class="px-4 py-2.5"><span class="sr-only">Remove</span></th>
						</tr>
					</thead>
					<tbody>
						{#each invited as person (person.uid)}
							<tr class="border-b border-border last:border-b-0">
								<td class="px-4 py-2.5 text-primary md:px-6">{person.email}</td>
								<td class="px-4 py-2.5 text-primary">{person.name || '—'}</td>
								<td class="px-4 py-2.5">
									<span
										class="inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold {STATUS_STYLES[
											person.status
										]}"
									>
										{STATUS_LABELS[person.status]}
									</span>
									{#if person.isWalkIn}
										<span
											class="ml-1 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
										>
											Walk-in
										</span>
									{/if}
								</td>
								<td class="px-4 py-2.5 text-muted-foreground">
									{invitedAtLabel(person.walkInInvitedAt)}
								</td>
								<td class="px-4 py-2.5 text-right">
									{#if person.status !== UserStatus.CHECKED_IN}
										<button
											type="button"
											onclick={() => uninvite(person)}
											disabled={!unlocked || uninviting === person.uid}
											aria-label="Remove the invite for {person.email}"
											title="Remove invite"
											class="cursor-pointer rounded-md border border-border bg-white p-1 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
										>
											<X class="size-3.5" aria-hidden="true" />
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
