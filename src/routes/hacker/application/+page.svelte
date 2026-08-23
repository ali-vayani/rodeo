<script lang="ts">
	import type { PageData } from './$types';
	import { Role, UserStatus } from '$lib/generated/prisma/enums';
	import { computeApplicationState, type ApplicationState } from '$lib/application/state';
	import { applicationWindowState } from '$lib/application/window';
	import { formatDateLong } from '$lib/format';
	import { errorMessage } from '$lib/ui/errors';
	import { createClient } from '$lib/trpc/client';
	import { untrack } from 'svelte';
	import { TriangleAlert } from 'lucide-svelte';
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
		if (!windowOpen) {
			console.error(`[application] Not saving ${questionId}: applications are ${windowState}.`);
			return;
		}

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
		// Dropping this silently is why an upload outside the window looks like a dead
		// button. Naming it is a stopgap for a page that should say so on screen.
		if (!windowOpen) {
			console.error(`[application] Not uploading ${file.name}: applications are ${windowState}.`);
			return;
		}

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

{#snippet pageHeading(title: string, sub: string | null)}
	<header class="mb-6">
		<h1 class="font-display text-display font-extrabold tracking-wide text-white uppercase">
			{title}
		</h1>
		{#if sub}
			<p class="mt-1 text-md text-white/80">{sub}</p>
		{/if}
	</header>
{/snippet}

<div class="mx-auto max-w-3xl">
	{#if currentState === 'filling'}
		{@render pageHeading(
			'Application',
			windowState === 'open'
				? "Answers save as you type. Submit once everything's filled in."
				: null
		)}

		<!--
			The window notice. Outside the window the form below is read-only, because the
			server refuses both the autosave and the submission behind it.
		-->
		{#if windowState === 'closed'}
			<p
				class="mb-6 flex flex-wrap items-center gap-2 bg-warning-50 px-4 py-3 text-base
				 font-medium text-warning-700"
				role="status"
			>
				<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
				Applications closed on {closesOn}. Your answers are shown below but can no longer be
				changed.
			</p>
		{:else if windowState === 'before'}
			<p
				class="mb-6 flex flex-wrap items-center gap-2 bg-info-50 px-4 py-3 text-base
				 font-medium text-info-700"
				role="status"
			>
				<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
				Applications open on {opensOn}. You can read the questions now and answer them once the form
				opens.
			</p>
		{:else if data.settings}
			<p
				class="mb-6 flex flex-wrap items-center gap-2 bg-warning-50 px-4 py-3 text-base
				 font-medium text-warning-700"
				role="status"
			>
				<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
				Applications close on {closesOn}.
			</p>
		{/if}

		<div class=" bg-card shadow-float">
			<div
				class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line-subtle
				 px-7 py-5"
			>
				<h2 class="text-lg font-bold text-foreground">Apply as</h2>
				<!-- The autosave state, said once, next to the thing it describes. -->
				<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
					{#if !windowOpen}
						Read-only
					{:else if saveStatus === 'saving'}
						Saving…
					{:else if saveStatus === 'saved'}
						Saved
					{:else if saveStatus === 'error'}
						<span class="text-destructive">{saveError ?? 'Save failed'}</span>
					{:else}
						Autosaves
					{/if}
				</span>
			</div>

			<div class="px-7 py-7">
				<RoleSelector
					selected={selectedRole}
					onselect={(r) => (selectedRole = r)}
					disabled={!windowOpen}
				/>

				{#if filteredQuestions.length === 0}
					<p class="mt-7 border-t border-brand-line-subtle pt-7 text-md text-muted-foreground">
						No questions yet — check back soon.
					</p>
				{:else}
					<div class="mt-7 flex flex-col gap-6 border-t border-brand-line-subtle pt-7">
						{#each filteredQuestions as question (question.id)}
							<QuestionRenderer
								{question}
								value={responses[question.id] ?? ''}
								onchange={(v) => handleQuestionChange(question.id, v)}
								onfile={(f) => handleFileUpload(question.id, f)}
								ownerId={user.uid}
								disabled={!windowOpen}
							/>
						{/each}
					</div>
				{/if}
			</div>

			<div
				class="flex flex-col gap-4 border-t border-brand-line-subtle bg-brand-well
				 px-7 py-5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-col gap-1.5">
					{#if requiredQuestions.length > 0}
						<span class="font-mono text-xs text-foreground-secondary">
							{answeredRequiredCount} / {requiredQuestions.length} required
						</span>
						<!-- The same count as a bar, so progress reads at a glance. -->
						<span class="block h-1 w-40 overflow-hidden bg-neutral-200" role="presentation">
							<span
								class="block h-full brand-rule transition-[width] duration-200"
								style="width: {(answeredRequiredCount / requiredQuestions.length) * 100}%"
							></span>
						</span>
					{/if}
				</div>

				<div class="flex flex-col gap-1.5 sm:items-end">
					<button
						type="button"
						onclick={handleSubmit}
						disabled={submitting || !canSubmit || !windowOpen}
						title={windowOpen ? undefined : `Applications closed on ${closesOn}.`}
						class="w-full cursor-pointer bg-brand-purple px-6 py-2.5 font-display
						 text-md font-semibold text-white transition-colors duration-150
						 hover:bg-brand-purple-hover focus-visible:shadow-ring
						 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
					>
						{submitting ? 'Submitting…' : 'Submit application'}
					</button>
					{#if windowState === 'closed'}
						<span class="text-xs text-foreground-secondary">The deadline has passed</span>
					{:else if windowState === 'before'}
						<span class="text-xs text-foreground-secondary">Opens {opensOn}</span>
					{:else if !canSubmit && requiredQuestions.length > 0}
						<span class="text-xs text-foreground-secondary">
							Answer all required questions to submit
						</span>
					{/if}
				</div>
			</div>

			{#if submitError}
				<p class="px-7 pb-5 text-md text-destructive" role="alert">{submitError}</p>
			{/if}
		</div>
	{:else}
		{@render pageHeading('Application', null)}
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
