<script lang="ts">
	import ScoreBar from './ScoreBar.svelte';
	import ApplicationResponses from './ApplicationResponses.svelte';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import type { ReviewPhase } from '$lib/admissions/reviewSession.svelte';
	import type { RubricCriterion } from '$lib/admissions/rubric';
	import { humanizeEnum } from '$lib/format';
	import type { BlacklistMatch } from '$lib/blacklist/match';

	let {
		applicant,
		rubric,
		maxScore,
		onSaveScore,
		onSaveRubricScore,
		onDecide,
		scoreLoading,
		decideLoading,
		hasPrev,
		hasNext,
		onPrev,
		onNext,
		onBack = undefined,
		lockState,
		claimerName,
		lockFreed,
		onReclaim
	}: {
		applicant: {
			uid: string;
			name: string;
			email: string;
			role: string;
			status: string;
			pendingDecision: string | null;
			activeDecision: string | null;
			score: number | null;
			scoreDelta: number | null;
			rubricSelections: Array<{ criterionId: string; levelId: string }>;
			notes: string | null;
			scoredAt: Date | string | null;
			scorer: { name: string } | null;
			decider: { name: string } | null;
			blacklistMatch: BlacklistMatch | null;
			createdAt: Date | string;
			application: Array<{
				value: string;
				userId: string;
				questionId: string;
				question: { title: string; order: number; type: string };
			}>;
		};
		rubric: RubricCriterion[];
		maxScore: number;
		onSaveScore: (score: number, notes: string) => void;
		onSaveRubricScore: (
			selections: Array<{ criterionId: string; levelId: string }>,
			delta: number,
			notes: string
		) => void;
		onDecide: (decision: 'ACCEPTED' | 'REJECTED' | 'WAITLISTED') => void;
		scoreLoading: boolean;
		decideLoading: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
		/** Below md the detail view replaces the list; this returns to it. */
		onBack?: () => void;
		lockState: ReviewPhase;
		claimerName: string | null;
		lockFreed: boolean;
		onReclaim: () => void;
	} = $props();

	// No banner while owned or acquiring: avoids a layout shift on every applicant switch.
	let banner = $derived.by(() => {
		if (lockState === 'locked') {
			return lockFreed ? 'No longer being reviewed. Claim it to make a decision.' : null; // null: claimer's name rendered below
		}
		if (lockState === 'expired') {
			return 'Your review session expired after inactivity. Resume review to make a decision.';
		}
		if (lockState === 'error') {
			return "Couldn't open this applicant for review. You can still read the application.";
		}
		return null;
	});

	let showBanner = $derived(
		lockState === 'locked' || lockState === 'expired' || lockState === 'error'
	);

	const DECISION_CLASS: Record<string, string> = {
		ACCEPTED: 'bg-[#d1fae5] text-[#065f46]',
		WAITLISTED: 'bg-[#fef9c3] text-[#713f12]',
		REJECTED: 'bg-[#fee2e2] text-[#991b1b]',
		PENDING: 'bg-[#e5e7eb] text-[#374151]'
	};

	function decLabel(d: string | null): string {
		if (!d) return '—';
		return d.charAt(0) + d.slice(1).toLowerCase();
	}

	function roleLabel(r: string): string {
		return r.charAt(0) + r.slice(1).toLowerCase();
	}

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	let pendingChip = $derived(
		applicant.pendingDecision === 'PENDING' ? null : applicant.pendingDecision
	);
</script>

<div class="flex h-full flex-col">
	{#if showBanner}
		<div
			class="flex shrink-0 items-center gap-2 border-b border-[#fde68a] bg-[#fffbeb] px-4 py-2.5 sm:px-5"
		>
			<span class="text-[12px] text-[#92400e]">
				{#if banner}
					{banner}
				{:else}
					<strong>{claimerName ?? 'Another admin'}</strong> is currently reviewing this applicant. View
					is read-only.
				{/if}
			</span>
		</div>
	{/if}

	<div class="shrink-0 border-b border-border px-4 pt-3 pb-3 sm:px-6 sm:pt-4">
		{#if onBack}
			<!-- Mobile only. Returning to the list also releases the claim. -->
			<button
				onclick={onBack}
				class="mb-2 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-base font-medium text-muted-foreground md:hidden"
			>
				← All applicants
			</button>
		{/if}
		<div class="flex items-start justify-between gap-3">
			<div>
				<div class="text-[18px] leading-[1.2] font-bold text-primary">
					{applicant.name}
				</div>
				<div class="mt-[3px] text-[13px] text-muted-foreground">{applicant.email}</div>
			</div>
			<div class="flex shrink-0 flex-wrap justify-end gap-1.5">
				<BlacklistBadge match={applicant.blacklistMatch} size="md" />
				{#if applicant.score !== null}
					<span
						class="inline-block rounded bg-[#eef2ff] px-2 py-[3px] font-mono text-[11px] font-semibold text-[#3730a3] tabular-nums"
					>
						{applicant.score}/{maxScore}
					</span>
				{/if}
				<span
					class="inline-block rounded bg-[#f0f0f0] px-2 py-[3px] text-[11px] font-semibold tracking-[0.04em] text-[#555] uppercase"
				>
					{roleLabel(applicant.role)}
				</span>
				<!-- PENDING is the enum's starting value, not a verdict: chipping it would
				     label every untouched applicant "Pending: Pending". -->
				{#if pendingChip}
					<span
						title={applicant.decider ? `Decided by ${applicant.decider.name}` : undefined}
						class="inline-block rounded px-2 py-[3px] text-[11px] font-semibold {DECISION_CLASS[
							pendingChip
						] ?? 'bg-[#e5e7eb] text-[#374151]'}"
					>
						Pending: {decLabel(pendingChip)}
					</span>
				{/if}
				{#if applicant.activeDecision}
					<span
						title={applicant.decider ? `Decided by ${applicant.decider.name}` : undefined}
						class="inline-block rounded px-2 py-[3px] text-[11px] font-semibold opacity-70 {DECISION_CLASS[
							applicant.activeDecision
						] ?? 'bg-[#e5e7eb] text-[#374151]'}"
					>
						Active: {decLabel(applicant.activeDecision)}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- One line, not a labelled grid: the grid cost 122px for facts a reviewer does not read. -->
	<div
		class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[#f0f0f0] px-4 py-2 text-[11px] text-muted-foreground sm:px-6"
	>
		<span>{humanizeEnum(applicant.status)}</span>
		<span aria-hidden="true">·</span>
		<span>Applied {formatDate(applicant.createdAt)}</span>
	</div>

	<div class="flex-1 px-4 py-5 sm:px-6 md:overflow-y-auto">
		{#if applicant.application.length > 0}
			<div class="mb-[14px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Application Responses
			</div>
		{/if}
		<ApplicationResponses responses={applicant.application} />
	</div>

	<!-- Keyed so switching applicants reseeds the drafts instead of carrying typing across. -->
	{#key applicant.uid}
		<ScoreBar
			score={applicant.score}
			notes={applicant.notes}
			scorerName={applicant.scorer?.name ?? null}
			scoredAt={applicant.scoredAt}
			{rubric}
			savedSelections={applicant.rubricSelections}
			savedDelta={applicant.scoreDelta}
			{maxScore}
			onSave={onSaveScore}
			onSaveRubric={onSaveRubricScore}
			{onDecide}
			saving={scoreLoading}
			deciding={decideLoading}
			{hasPrev}
			{hasNext}
			{onPrev}
			{onNext}
			{lockState}
			{claimerName}
			{lockFreed}
			{onReclaim}
		/>
	{/key}
</div>
