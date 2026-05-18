<script lang="ts">
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
	let currentState = $state<ApplicationState>(computeApplicationState(data.user));

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
			await trpc.application.submit.mutate();
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
	let canJoinTeam = $derived(currentState === "rsvpd" || currentState === "checked-in");

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
		<div class="mb-6 rounded border bg-white p-5" style="border-color: #e0e0e0">
			<p class="mb-0.5 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
				Team Invitation
			</p>
			<p class="mb-3 text-base font-semibold" style="color: #191919">
				Join <span class="font-bold">{joinTeam.teamName}</span>
				<span class="ml-1 text-sm font-normal" style="color: #aaaaaa">
					({joinTeam.memberCount}/4 members)
				</span>
			</p>
			{#if joinError}
				<p class="mb-3 text-sm" style="color: #b00000">{joinError}</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					onclick={handleJoinTeam}
					disabled={joining}
					class="rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
					style="background: #191919; color: #fff"
				>
					{joining ? 'Joining…' : 'Join team'}
				</button>
				<button
					type="button"
					onclick={() => (joinTeam = null)}
					class="rounded border px-4 py-2 text-sm transition-colors hover:bg-[--color-muted]"
					style="border-color: #e0e0e0; color: #191919"
				>
					Dismiss
				</button>
			</div>
		</div>
	{:else if joinTeam && joinSuccess}
		<div class="mb-6 rounded border bg-white p-5" style="border-color: #e0e0e0">
			<p class="text-sm font-medium" style="color: #191919">
				You joined <strong>{joinTeam.teamName}</strong>.
				<a href="/hacker/account" class="ml-1 underline" style="color: #aaaaaa">Go to your account →</a>
			</p>
		</div>
	{/if}

	{#if currentState === 'filling'}
		<!-- Header -->
		<div class="mb-6">
			<h1 class="text-2xl font-semibold" style="color: #191919">Application</h1>
			<p class="mt-1 text-sm" style="color: #aaaaaa">
				Fill out the form below and submit when you're ready.
			</p>
		</div>

		<!-- Form card -->
		<div class="rounded border bg-white p-6" style="border-color: #e0e0e0">
			<!-- Role selector -->
			<div class="mb-6">
				<RoleSelector selected={selectedRole} onselect={(r) => (selectedRole = r)} />
			</div>

			<div class="mb-6 border-t" style="border-color: #e0e0e0"></div>

			<!-- Questions -->
			{#if filteredQuestions.length === 0}
				<p class="text-sm" style="color: #aaaaaa">No questions yet — check back soon.</p>
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
			<div class="mt-8 flex items-center justify-between border-t pt-5" style="border-color: #e0e0e0">
				<!-- Progress + save status -->
				<div class="flex flex-col gap-0.5">
					{#if requiredQuestions.length > 0}
						<span class="font-mono text-xs" style="color: #aaaaaa">
							{answeredRequiredCount} / {requiredQuestions.length} required
						</span>
					{/if}
					{#if saveStatus === 'saving'}
						<span class="font-mono text-xs" style="color: #aaaaaa">Saving…</span>
					{:else if saveStatus === 'saved'}
						<span class="font-mono text-xs" style="color: #aaaaaa">Saved</span>
					{:else if saveStatus === 'error'}
						<span class="font-mono text-xs" style="color: #b00000">Save failed</span>
					{/if}
				</div>

				<!-- Submit button -->
				<div class="flex flex-col items-end gap-1">
					<button
						type="button"
						onclick={handleSubmit}
						disabled={submitting || !canSubmit}
						class="rounded px-5 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
						style="background: #191919; color: #fff"
					>
						{submitting ? 'Submitting…' : 'Submit Application'}
					</button>
					{#if !canSubmit && requiredQuestions.length > 0}
						<span class="text-xs" style="color: #aaaaaa">Answer all required questions to submit</span>
					{/if}
				</div>
			</div>

			{#if submitError}
				<p class="mt-3 text-sm" style="color: #b00000">{submitError}</p>
			{/if}
		</div>

	{:else}
		<!-- Non-filling states -->
		<div class="mb-6">
			<h1 class="text-2xl font-semibold" style="color: #191919">Application</h1>
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
