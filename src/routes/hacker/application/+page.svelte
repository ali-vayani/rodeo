<script lang="ts">
	import type { PageData } from './$types';
	import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/enums';
	import { createClient } from '$lib/trpc/client';
	import { untrack } from 'svelte';
	import RoleSelector from '$lib/components/application/RoleSelector.svelte';
	import QuestionRenderer from '$lib/components/application/QuestionRenderer.svelte';
	import ApplicationStateView from '$lib/components/application/ApplicationStateView.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// --- State machine ---
	// Determine which view to show based on user status/decision
	type AppState = 'filling' | 'submitted' | 'waitlisted' | 'accepted' | 'rejected' | 'rsvpd';

	function computeState(): AppState {
		const { user } = data;
		if (user.status === UserStatus.CONFIRMED) return 'rsvpd';
		if (user.activeDecision === DecisionStatus.ACCEPTED) return 'accepted';
		if (user.activeDecision === DecisionStatus.WAITLISTED) return 'waitlisted';
		if (user.activeDecision === DecisionStatus.REJECTED) return 'rejected';
		if (user.status === UserStatus.APPLIED) return 'submitted';
		return 'filling';
	}

	let currentState = $state<AppState>(computeState());

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

	// --- RSVP ---
	let rsvping = $state(false);

	async function handleRsvp() {
		rsvping = true;
		try {
			await trpc.application.rsvp.mutate();
			user.status = UserStatus.CONFIRMED;
			currentState = 'rsvpd';
		} catch {
			// silently leave state unchanged; user sees the button again
		} finally {
			rsvping = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl">
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
		<ApplicationStateView {user} settings={data.settings} onrsvp={handleRsvp} {rsvping} />
	{/if}
</div>
