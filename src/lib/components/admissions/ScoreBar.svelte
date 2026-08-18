<script lang="ts">
	import { untrack } from 'svelte';
	import type { ReviewPhase } from '$lib/admissions/reviewSession.svelte';
	import { MAX_SCORE, MIN_SCORE, isValidScore } from '$lib/admissions/score';
	import { Button, Textarea } from '$lib/components/ui';
	import { formatDate } from '$lib/format';

	let {
		score,
		notes,
		scorerName,
		scoredAt,
		onSave,
		saving,
		hasPrev,
		hasNext,
		onPrev,
		onNext,
		lockState,
		claimerName,
		lockFreed,
		onReclaim
	}: {
		score: number | null;
		notes: string | null;
		/** Who last scored this applicant, when it wasn't nobody. */
		scorerName: string | null;
		scoredAt: Date | string | null;
		onSave: (score: number, notes: string) => void;
		saving: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
		lockState: ReviewPhase;
		claimerName: string | null;
		lockFreed: boolean;
		onReclaim: () => void;
	} = $props();

	/**
	 * Drafts, not bindings. The parent remounts this bar per applicant (`{#key}`),
	 * which is what seeds them — an `$effect` syncing props into state would fight
	 * the reviewer's own typing on every parent update.
	 */
	/**
	 * Held as a number, not a string: `bind:value` on `<input type="number">`
	 * coerces, so this is whatever the DOM hands back — a number, or undefined
	 * once the field is cleared. Typing it as a string and calling `.trim()` on
	 * it threw on the first keystroke and left Save permanently disabled.
	 */
	let scoreDraft = $state<number | undefined>(untrack(() => score ?? undefined));
	let notesDraft = $state(untrack(() => notes ?? ''));

	let empty = $derived(scoreDraft === undefined || Number.isNaN(scoreDraft));
	let valid = $derived(!empty && isValidScore(scoreDraft as number));

	// While the claim is in flight the controls stay put but dimmed, matching how
	// the queue behaved before: flashing a read-only strip on every applicant
	// switch trains reviewers to click through it.
	let showControls = $derived(lockState === 'owned' || lockState === 'acquiring');
	let busy = $derived(saving || lockState === 'acquiring');

	const STATUS_LABEL: Record<string, string> = {
		expired: 'Session expired',
		error: "Couldn't lock this applicant"
	};

	const ACTION_LABEL: Record<string, string> = {
		expired: 'Resume review',
		error: 'Retry'
	};

	let statusText = $derived(
		lockState === 'locked'
			? lockFreed
				? 'No longer being reviewed'
				: `${claimerName ?? 'Another admin'} is reviewing`
			: (STATUS_LABEL[lockState] ?? 'Read-only')
	);

	let actionText = $derived(
		lockState === 'locked' ? 'Claim' : (ACTION_LABEL[lockState] ?? 'Claim')
	);

	// Nothing to offer while someone else genuinely holds the lock — the server
	// refuses any claim against a fresh one, so a button would be a no-op that
	// reads like a force-takeover. The presence poll flips this once it frees up.
	let showAction = $derived(lockState !== 'locked' || lockFreed);
	let actionIsPrimary = $derived(lockState === 'expired' || (lockState === 'locked' && lockFreed));

	function save() {
		if (!valid || busy) return;
		onSave(scoreDraft as number, notesDraft);
	}

	/**
	 * Enter saves from the score field.
	 *
	 * The whole pass is type-a-number-move-on, several hundred times; reaching for
	 * the mouse between each one is the cost this removes. Not wired to the notes
	 * box, where Enter has to stay a newline.
	 */
	function onScoreKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		save();
	}
</script>

<!-- Sticky below md so the score field stays reachable while a long application
     scrolls past; static from md up, where the detail pane scrolls internally. -->
<div
	class="sticky bottom-0 z-10 shrink-0 border-t border-border bg-white px-4 py-3 sm:px-5 md:static md:z-auto"
>
	{#if !showControls}
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<div class="flex gap-1.5">
				<Button size="sm" onclick={onPrev} disabled={!hasPrev}>← Prev</Button>
				<Button size="sm" onclick={onNext} disabled={!hasNext}>Next →</Button>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-xs text-foreground-secondary italic">{statusText}</span>
				{#if showAction}
					<Button size="sm" variant={actionIsPrimary ? 'primary' : 'secondary'} onclick={onReclaim}>
						{actionText}
					</Button>
				{/if}
			</div>
		</div>
	{:else}
		<Textarea
			bind:value={notesDraft}
			rows={2}
			disabled={busy}
			placeholder="Notes (optional) — every admin sees these during the decision pass"
			aria-label="Reviewer notes"
			class="text-touch sm:text-base"
		/>

		<div class="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<div class="flex gap-1.5">
				<Button size="sm" onclick={onPrev} disabled={!hasPrev || busy}>← Prev</Button>
				<Button size="sm" onclick={onNext} disabled={!hasNext || busy}>Next →</Button>
			</div>

			<div class="flex items-center gap-2.5 max-md:w-full">
				<!--
					A plain labelled number field rather than 21 buttons or a slider: the
					reviewer already has both hands on the keyboard reading the answers,
					and a slider can't be typed into.
				-->
				<label for="score-input" class="text-xs font-semibold whitespace-nowrap text-foreground">
					Score
				</label>
				<input
					id="score-input"
					type="number"
					inputmode="numeric"
					min={MIN_SCORE}
					max={MAX_SCORE}
					step="1"
					bind:value={scoreDraft}
					onkeydown={onScoreKeydown}
					disabled={busy}
					aria-invalid={!empty && !valid}
					class="w-18 rounded-md border bg-card px-2.5 py-1.5 text-center font-mono text-touch
					       tabular-nums outline-none focus-visible:shadow-ring sm:text-base
					       {!empty && !valid ? 'border-danger-500' : 'border-border'}"
				/>
				<span class="font-mono text-2xs text-foreground-tertiary">/ {MAX_SCORE}</span>
				<Button
					variant="primary"
					size="sm"
					loading={saving}
					disabled={!valid || busy}
					onclick={save}
					class="max-md:flex-1"
				>
					{hasNext ? 'Save & next' : 'Save score'}
				</Button>
			</div>
		</div>

		<!-- Re-scoring overwrites, attribution included, so say whose number is on
		     screen before someone changes it. -->
		{#if score !== null && scorerName}
			<div class="mt-2 text-2xs text-foreground-tertiary">
				Scored {score}/{MAX_SCORE} by {scorerName}{scoredAt ? ` · ${formatDate(scoredAt)}` : ''}
			</div>
		{/if}
	{/if}
</div>
