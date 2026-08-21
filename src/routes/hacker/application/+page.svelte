<script lang="ts">
	import type { PageData } from './$types';
	import { Role, UserStatus } from '$lib/generated/prisma/enums';
	import { computeApplicationState, type ApplicationState } from '$lib/application/state';
	import { applicationWindowState } from '$lib/application/window';
	import { formatDateLong } from '$lib/format';
	import { errorMessage } from '$lib/ui/errors';
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
	// untrack, like `user` below: the initial state is a snapshot, and the mutations on
	// this page advance it explicitly.
	let currentState = $state<ApplicationState>(untrack(() => computeApplicationState(data.user)));

	// Mutable copy of user so we can update after mutations. untrack because page data
	// does not change.
	let user = $state(untrack(() => ({ ...data.user })));

	// --- Form state ---
	const ROLES_FOR_APPLICATION: Role[] = [Role.HACKER, Role.JUDGE, Role.MENTOR, Role.VOLUNTEER];

	// The account's own role when it is one you can apply as, else HACKER. An
	// UNDECLARED account — the state a self-registered user can land in — has no
	// application-relevant role yet, so the form opens on the common case.
	function initialRole(): Role {
		return ROLES_FOR_APPLICATION.includes(user.role) ? user.role : Role.HACKER;
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

	// --- Application window ---
	// `application.save` and `application.submit` are both gated on this window, so
	// outside it the form was live but every keystroke was thrown away by the server.
	let windowState = $derived(applicationWindowState(data.settings));
	let windowOpen = $derived(windowState === 'open');
	let opensOn = $derived(formatDateLong(data.settings?.applicationOpen));
	let closesOn = $derived(formatDateLong(data.settings?.applicationDeadline));

	// --- Auto-save ---
	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
	let saveStatus = $state<SaveStatus>('idle');
	let saveError = $state<string | null>(null);
	let saveTimers = $state<Record<string, ReturnType<typeof setTimeout>>>({});

	async function handleQuestionChange(questionId: string, value: string) {
		// Belt and braces: the fields are already disabled outside the window. This exists
		// so a stale page open since before the deadline cannot fire a burst of writes.
		if (!windowOpen) return;

		responses[questionId] = value;

		// Debounce per question
		if (saveTimers[questionId]) clearTimeout(saveTimers[questionId]);
		saveStatus = 'saving';
		saveTimers[questionId] = setTimeout(async () => {
			try {
				await trpc.application.save.mutate({ questionId, value });
				saveStatus = 'saved';
				saveError = null;
			} catch (e) {
				// The reason, not just the fact. A save refused because the deadline passed while
				// the tab sat open is worth naming: "Save failed" alone reads as a network blip.
				saveStatus = 'error';
				saveError = errorMessage(e, 'Save failed');
			}
		}, 800);
	}

	/**
	 * Upload a file answer. Not debounced — picking a file is one deliberate act, not a
	 * burst of keystrokes. The endpoint writes the response row alongside the bytes, so
	 * there is no `application.save` call: that procedure refuses FILE questions.
	 */
	async function handleFileUpload(questionId: string, file: File) {
		if (!windowOpen) return;

		saveStatus = 'saving';
		try {
			const body = new FormData();
			body.append('file', file);
			const res = await fetch(`/hacker/application/files/${questionId}`, { method: 'POST', body });

			if (!res.ok) {
				// SvelteKit's `error()` returns `{ message }`; a platform-level 413 returns
				// neither JSON nor that shape.
				const reason = await res
					.json()
					.then((b) => b?.message)
					.catch(() => null);
				throw new Error(reason ?? `Upload failed (${res.status})`);
			}

			const { filename } = await res.json();
			responses[questionId] = filename;
			saveStatus = 'saved';
			saveError = null;
		} catch (e) {
			saveStatus = 'error';
			saveError = errorMessage(e, 'Upload failed');
		}
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

	// Destructured as aliases because both handlers expose `error`; the getters are
	// re-wrapped below so the rename doesn't freeze the value at destructure time.
	const rsvp = createRsvpHandler({
		user,
		onSuccess: () => {
			currentState = 'rsvpd';
		}
	});

	const decline = createDeclineHandler({
		user,
		onSuccess: () => {
			currentState = 'declined';
		}
	});

	// The team-invite banner used to live here. It now renders from `hacker/+layout`
	// so it persists across the portal instead of only appearing on this page — see
	// `$lib/server/invite.ts`.
</script>

<div class="mx-auto max-w-2xl">
	{#if currentState === 'filling'}
		<!-- Header -->
		<div class="mb-6">
			<h1 class="text-2xl font-semibold text-primary">Application</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				{#if windowState === 'closed'}
					Applications closed on {closesOn}.
				{:else if windowState === 'before'}
					Applications open on {opensOn}.
				{:else}
					Fill out the form below and submit when you're ready.
					<!-- The deadline while it still matters, not only once it's too late. -->
					{#if data.settings}
						Applications close on {closesOn}.
					{/if}
				{/if}
			</p>
		</div>

		<!--
					The window notice. Outside the window the form below is read-only, because the
					server refuses both the autosave and the submission behind it.
				-->
		{#if !windowOpen}
			<div class="mb-6 rounded border border-border bg-white p-5">
				<p class="mb-0.5 text-xs font-medium tracking-widest text-muted-foreground uppercase">
					{windowState === 'closed' ? 'Applications closed' : 'Applications not open yet'}
				</p>
				{#if windowState === 'closed'}
					<p class="text-sm leading-relaxed text-primary">
						The deadline was <strong>{closesOn}</strong>. Your answers are shown below but can no
						longer be changed or submitted. Contact the organizers if you believe this is a mistake.
					</p>
				{:else}
					<p class="text-sm leading-relaxed text-primary">
						Applications open on <strong>{opensOn}</strong>. You can read through the questions now
						— you'll be able to answer them once the form opens.
					</p>
				{/if}
			</div>
		{/if}

		<!-- Form card -->
		<div class="rounded border border-border bg-white p-6">
			<!-- Role selector -->
			<div class="mb-6">
				<RoleSelector
					selected={selectedRole}
					onselect={(r) => (selectedRole = r)}
					disabled={!windowOpen}
				/>
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
							onfile={(f) => handleFileUpload(question.id, f)}
							disabled={!windowOpen}
						/>
					{/each}
				</div>
			{/if}

			<!-- Footer row -->
			<div
				class="mt-8 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"
			>
				<!-- Progress + save status -->
				<div class="flex flex-col gap-0.5">
					{#if requiredQuestions.length > 0}
						<span class="font-mono text-xs text-muted-foreground">
							{answeredRequiredCount} / {requiredQuestions.length} required
						</span>
					{/if}
					{#if !windowOpen}
						<span class="font-mono text-xs text-muted-foreground">Read-only</span>
					{:else if saveStatus === 'saving'}
						<span class="font-mono text-xs text-muted-foreground">Saving…</span>
					{:else if saveStatus === 'saved'}
						<span class="font-mono text-xs text-muted-foreground">Saved</span>
					{:else if saveStatus === 'error'}
						<span class="font-mono text-xs text-destructive">{saveError ?? 'Save failed'}</span>
					{/if}
				</div>

				<!-- Submit button -->
				<div class="flex flex-col gap-1 sm:items-end">
					<button
						type="button"
						onclick={handleSubmit}
						disabled={submitting || !canSubmit || !windowOpen}
						title={windowOpen ? undefined : `Applications closed on ${closesOn}.`}
						class="w-full rounded bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
					>
						{submitting ? 'Submitting…' : 'Submit Application'}
					</button>
					{#if windowState === 'closed'}
						<span class="text-xs text-muted-foreground">The deadline has passed</span>
					{:else if windowState === 'before'}
						<span class="text-xs text-muted-foreground">Opens {opensOn}</span>
					{:else if !canSubmit && requiredQuestions.length > 0}
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
			onrsvp={rsvp.handleRsvp}
			rsvping={rsvp.rsvping}
			rsvpError={rsvp.error}
			ondecline={decline.handleDecline}
			declining={decline.declining}
			declineError={decline.error}
		/>
	{/if}
</div>
