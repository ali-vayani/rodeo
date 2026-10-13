<script lang="ts">
	import type { PageData } from './$types';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { UserStatus, type Role } from '$lib/generated/prisma/enums';
	import { isAnswered } from '$lib/questions/isAnswered';
	import { errorMessage } from '$lib/ui/errors';
	import { createClient } from '$lib/trpc/client';
	import QuestionRenderer from '$lib/components/application/QuestionRenderer.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// Mutable copy: `confirm` advances the status without a page reload.
	let user = $state(untrack(() => ({ ...data.user })));

	let responses = $state<Record<string, string>>(
		untrack(() => Object.fromEntries(data.responses.map((r) => [r.questionId, r.value])))
	);

	// Same split as the application page: `responses` is optimistic for typing,
	// `savedResponses` is what the server has and what confirm will validate.
	let savedResponses = $state<Record<string, string>>(
		untrack(() => Object.fromEntries(data.responses.map((r) => [r.questionId, r.value])))
	);

	// Only the walk-in subset, in the stored role's audience — the server validates
	// against exactly this set in `walkin.confirm`.
	let walkInQuestions = $derived(
		data.questions.filter(
			(q) => q.walkIn && (q.targetRole.length === 0 || (q.targetRole as Role[]).includes(user.role))
		)
	);

	let requiredQuestions = $derived(walkInQuestions.filter((q) => q.required));
	let answeredRequiredCount = $derived(
		requiredQuestions.filter((q) => isAnswered(q.type, savedResponses[q.id])).length
	);

	// An account that already applied confirms as-is; a fresh one must finish the form.
	let needsApplication = $derived(user.status === UserStatus.CREATED);
	let canConfirm = $derived(
		!needsApplication || answeredRequiredCount === requiredQuestions.length
	);

	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
	let saveStatus = $state<SaveStatus>('idle');
	let saveError = $state<string | null>(null);
	let saveTimers = $state<Record<string, ReturnType<typeof setTimeout>>>({});

	function handleQuestionChange(questionId: string, value: string) {
		responses[questionId] = value;

		if (saveTimers[questionId]) clearTimeout(saveTimers[questionId]);
		saveStatus = 'saving';
		saveTimers[questionId] = setTimeout(async () => {
			try {
				await trpc.application.save.mutate({ questionId, value });
				savedResponses[questionId] = value;
				saveStatus = 'saved';
				saveError = null;
			} catch (e) {
				saveStatus = 'error';
				saveError = errorMessage(e, 'Save failed');
			}
		}, 800);
	}

	async function handleFileUpload(questionId: string, file: File) {
		saveStatus = 'saving';
		try {
			const body = new FormData();
			body.append('file', file);
			const res = await fetch(`/hacker/application/files/${questionId}`, { method: 'POST', body });

			if (!res.ok) {
				const reason = await res
					.json()
					.then((b) => b?.message)
					.catch(() => null);
				throw new Error(reason ?? `Upload failed (${res.status})`);
			}

			const { filename } = await res.json();
			responses[questionId] = filename;
			savedResponses[questionId] = filename;
			saveStatus = 'saved';
			saveError = null;
		} catch (e) {
			saveStatus = 'error';
			saveError = errorMessage(e, 'Upload failed');
		}
	}

	let confirming = $state(false);
	let confirmError = $state<string | null>(null);

	async function handleConfirm() {
		confirmError = null;
		confirming = true;
		try {
			const updated = await trpc.walkin.confirm.mutate();
			user = { ...user, ...updated };
		} catch (e) {
			confirmError = errorMessage(e, 'Confirmation failed');
		} finally {
			confirming = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl">
	<header class="mb-6">
		<h1 class="font-display text-display font-extrabold tracking-wide text-white uppercase">
			Walk-In
		</h1>
		<p class="mt-1 text-md text-white/80">
			You've been invited to join as a walk-in.
			{#if needsApplication}
				Fill out the form below, then confirm your spot.
			{/if}
		</p>
	</header>

	{#if user.status === UserStatus.CHECKED_IN}
		<div class="bg-card px-7 py-7 shadow-float">
			<h2 class="text-lg font-bold text-foreground">You're checked in</h2>
			<p class="mt-2 text-md text-muted-foreground">Nothing left to do here — enjoy the event!</p>
		</div>
	{:else if user.status === UserStatus.CONFIRMED}
		<div class="bg-card px-7 py-7 shadow-float">
			<h2 class="text-lg font-bold text-foreground">Your spot is confirmed</h2>
			<p class="mt-2 text-md text-muted-foreground">
				Show the QR code on your Account page at the check-in desk. It's also in the confirmation
				email we just sent you.
			</p>
			<a
				href={resolve('/hacker/account')}
				class="mt-5 inline-block bg-brand-purple px-6 py-2.5 font-display text-md font-semibold
				 text-white no-underline transition-colors duration-150 hover:bg-brand-purple-hover
				 focus-visible:shadow-ring"
			>
				Open my QR code
			</a>
		</div>
	{:else}
		<div class="bg-card shadow-float">
			{#if needsApplication}
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line-subtle
					 px-7 py-5"
				>
					<h2 class="text-lg font-bold text-foreground">Walk-in application</h2>
					<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
						{#if saveStatus === 'saving'}
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
					{#if walkInQuestions.length === 0}
						<p class="text-md text-muted-foreground">
							No walk-in questions have been set up — you can confirm your spot right away.
						</p>
					{:else}
						<div class="flex flex-col gap-6">
							{#each walkInQuestions as question (question.id)}
								<QuestionRenderer
									{question}
									value={responses[question.id] ?? ''}
									onchange={(v) => handleQuestionChange(question.id, v)}
									onfile={(f) => handleFileUpload(question.id, f)}
									ownerId={user.uid}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<div class="px-7 py-7">
					<h2 class="text-lg font-bold text-foreground">We already have your application</h2>
					<p class="mt-2 text-md text-muted-foreground">
						Nothing to fill out — confirm below and your application counts as your walk-in
						registration.
					</p>
				</div>
			{/if}

			<div
				class="flex flex-col gap-4 border-t border-brand-line-subtle bg-brand-well
				 px-7 py-5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-col gap-1.5">
					{#if needsApplication && requiredQuestions.length > 0}
						<span class="font-mono text-xs text-foreground-secondary">
							{answeredRequiredCount} / {requiredQuestions.length} required
						</span>
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
						onclick={handleConfirm}
						disabled={confirming || !canConfirm}
						class="w-full cursor-pointer bg-brand-purple px-6 py-2.5 font-display
						 text-md font-semibold text-white transition-colors duration-150
						 hover:bg-brand-purple-hover focus-visible:shadow-ring
						 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
					>
						{confirming ? 'Confirming…' : 'Confirm my spot'}
					</button>
					{#if needsApplication && !canConfirm && requiredQuestions.length > 0}
						<span class="text-xs text-foreground-secondary">
							Answer all required questions to confirm
						</span>
					{/if}
				</div>
			</div>

			{#if confirmError}
				<p class="px-7 pb-5 text-md text-destructive" role="alert">{confirmError}</p>
			{/if}
		</div>
	{/if}
</div>
