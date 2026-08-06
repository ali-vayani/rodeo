<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { Role, UserStatus } from '$lib/generated/prisma/enums';
	import { computeApplicationState, type ApplicationState } from '$lib/application/state';
	import { createClient } from '$lib/trpc/client';
	import { untrack } from 'svelte';
	import RoleSelector from '$lib/components/application/RoleSelector.svelte';
	import QuestionRenderer from '$lib/components/application/QuestionRenderer.svelte';
	import ApplicationStateView from '$lib/components/application/ApplicationStateView.svelte';
	import { createRsvpHandler } from '$lib/application/rsvp.svelte';
	import { createDeclineHandler } from '$lib/application/decline.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// --- State machine ---
	// untrack, like `user` below: the initial state is a snapshot, and the
	// mutations on this page advance it explicitly.
	let currentState = $state<ApplicationState>(untrack(() => computeApplicationState(data.user)));

	// Mutable copy of user so we can update after mutations
	// untrack: we intentionally snapshot the initial value; page data doesn't change
	let user = $state(untrack(() => ({ ...data.user })));

	// --- Form state ---
	const ROLES_FOR_APPLICATION: Role[] = [Role.HACKER, Role.JUDGE, Role.MENTOR, Role.VOLUNTEER];

	// Pick initial role: first application-relevant role from user, or HACKER
	function initialRole(): Role {
		const existing = user.roles.find((r) => ROLES_FOR_APPLICATION.includes(r));
		return existing ?? Role.HACKER;
	}

	let selectedRole = $state<Role>(initialRole());

	// Response map: questionId → value (string)
	let responses = $state<Record<string, string>>(
		untrack(() => Object.fromEntries(data.responses.map((r) => [r.questionId, r.value])))
	);

	// --- Filtered questions ---
	let filteredQuestions = $derived(
		data.questions.filter(
			(q) => q.targetRole.length === 0 || (q.targetRole as Role[]).includes(selectedRole)
		)
	);

	let requiredQuestions = $derived(filteredQuestions.filter((q) => q.required));

	let answeredRequiredCount = $derived(
		requiredQuestions.filter((q) => {
			const v = responses[q.id];
			return v !== undefined && v.trim() !== '';
		}).length
	);

	let canSubmit = $derived(answeredRequiredCount === requiredQuestions.length);

	// --- Auto-save ---
	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
	let saveStatus = $state<SaveStatus>('idle');
	let saveTimers = $state<Record<string, ReturnType<typeof setTimeout>>>({});

	async function handleQuestionChange(questionId: string, value: string) {
		responses[questionId] = value;

		// Debounce per question
		if (saveTimers[questionId]) clearTimeout(saveTimers[questionId]);
		saveStatus = 'saving';
		saveTimers[questionId] = setTimeout(async () => {
			try {
				await trpc.application.save.mutate({ questionId, value });
				saveStatus = 'saved';
			} catch {
				saveStatus = 'error';
			}
		}, 800);
	}

	// --- Submit ---
	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	async function handleSubmit() {
		submitError = null;
		submitting = true;
		try {
			// Send the role the form was filled out as, so the server validates the right
			// required set and records the applicant under that role rather than HACKER.
			await trpc.application.submit.mutate({ role: selectedRole });
			user.status = UserStatus.APPLIED;
			currentState = 'submitted';
		} catch (e: unknown) {
			submitError = e instanceof Error ? e.message : 'Submission failed.';
		} finally {
			submitting = false;
		}
	}

	const { rsvping, handleRsvp } = createRsvpHandler({
		user,
		onSuccess: () => {
			currentState = 'rsvpd';
		}
	});

	const { declining, handleDecline } = createDeclineHandler({
		user,
		onSuccess: () => {
			currentState = 'declined';
		}
	});

	// --- Team join via invite link ---
	let joinTeam = $state(untrack(() => data.joinTeam));
	let joining = $state(false);
	let joinError = $state<string | null>(null);
	let joinSuccess = $state(false);
	let canJoinTeam = $derived(currentState === 'rsvpd' || currentState === 'checked-in');

	async function handleJoinTeam() {
		if (!joinTeam || !canJoinTeam) return;
		joining = true;
		joinError = null;
		try {
			await trpc.team.joinByCode.mutate({ inviteCode: joinTeam.inviteCode });
			joinSuccess = true;
		} catch (e) {
			joinError = e instanceof Error ? e.message : 'Failed to join team.';
		} finally {
			joining = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl">
	<!-- Team invite link banner -->
	{#if joinTeam && !joinSuccess && canJoinTeam}
		<div class="mb-6 rounded border border-border bg-white p-5">
			<p class="mb-0.5 text-xs font-medium tracking-widest text-muted-foreground uppercase">
				Team Invitation
			</p>
			<p class="mb-3 text-base font-semibold text-primary">
				Join <span class="font-bold">{joinTeam.teamName}</span>
				<span class="ml-1 text-sm font-normal text-muted-foreground">
					({joinTeam.memberCount}/4 members)
				</span>
			</p>
			{#if joinError}
				<p class="mb-3 text-sm text-destructive">{joinError}</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					onclick={handleJoinTeam}
					disabled={joining}
					class="rounded bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
				>
					{joining ? 'Joining…' : 'Join team'}
				</button>
				<button
					type="button"
					onclick={() => (joinTeam = null)}
					class="rounded border border-border px-4 py-2 text-sm text-primary transition-colors hover:bg-[--color-muted]"
				>
					Dismiss
				</button>
			</div>
		</div>
	{:else if joinTeam && joinSuccess}
		<div class="mb-6 rounded border border-border bg-white p-5">
			<p class="text-sm font-medium text-primary">
				You joined <strong>{joinTeam.teamName}</strong>.
				<a href={resolve('/hacker/account')} class="ml-1 text-muted-foreground underline"
					>Go to your account →</a
				>
			</p>
		</div>
	{/if}

	{#if currentState === 'filling'}
		<!-- Header -->
		<div class="mb-6">
			<h1 class="text-2xl font-semibold text-primary">Application</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Fill out the form below and submit when you're ready.
			</p>
		</div>

		<!-- Form card -->
		<div class="rounded border border-border bg-white p-6">
			<!-- Role selector -->
			<div class="mb-6">
				<RoleSelector selected={selectedRole} onselect={(r) => (selectedRole = r)} />
			</div>

			<div class="mb-6 border-t border-border"></div>

			<!-- Questions -->
			{#if filteredQuestions.length === 0}
				<p class="text-sm text-muted-foreground">No questions yet — check back soon.</p>
			{:else}
				<div class="flex flex-col gap-5">
					{#each filteredQuestions as question (question.id)}
						<QuestionRenderer
							{question}
							value={responses[question.id] ?? ''}
							onchange={(v) => handleQuestionChange(question.id, v)}
						/>
					{/each}
				</div>
			{/if}

			<!-- Footer row -->
			<div class="mt-8 flex items-center justify-between border-t border-border pt-5">
				<!-- Progress + save status -->
				<div class="flex flex-col gap-0.5">
					{#if requiredQuestions.length > 0}
						<span class="font-mono text-xs text-muted-foreground">
							{answeredRequiredCount} / {requiredQuestions.length} required
						</span>
					{/if}
					{#if saveStatus === 'saving'}
						<span class="font-mono text-xs text-muted-foreground">Saving…</span>
					{:else if saveStatus === 'saved'}
						<span class="font-mono text-xs text-muted-foreground">Saved</span>
					{:else if saveStatus === 'error'}
						<span class="font-mono text-xs text-destructive">Save failed</span>
					{/if}
				</div>

				<!-- Submit button -->
				<div class="flex flex-col items-end gap-1">
					<button
						type="button"
						onclick={handleSubmit}
						disabled={submitting || !canSubmit}
						class="rounded bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
					>
						{submitting ? 'Submitting…' : 'Submit Application'}
					</button>
					{#if !canSubmit && requiredQuestions.length > 0}
						<span class="text-xs text-muted-foreground"
							>Answer all required questions to submit</span
						>
					{/if}
				</div>
			</div>

			{#if submitError}
				<p class="mt-3 text-sm text-destructive">{submitError}</p>
			{/if}
		</div>
	{:else}
		<!-- Non-filling states -->
		<div class="mb-6">
			<h1 class="text-2xl font-semibold text-primary">Application</h1>
		</div>
		<ApplicationStateView
			{user}
			settings={data.settings}
			onrsvp={handleRsvp}
			{rsvping}
			ondecline={handleDecline}
			{declining}
		/>
	{/if}
</div>
