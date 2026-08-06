<script lang="ts">
	import DecisionBar from './DecisionBar.svelte';
	import BlacklistBadge from './BlacklistBadge.svelte';
	import type { ReviewPhase } from '$lib/admissions/reviewSession.svelte';
	import type { BlacklistMatch } from '$lib/blacklist/match';
	import type { DecisionStatus } from '$lib/generated/prisma/enums';

	let {
		applicant,
		onDecision,
		decisionLoading,
		hasPrev,
		hasNext,
		onPrev,
		onNext,
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
			blacklistMatch: BlacklistMatch | null;
			createdAt: Date | string;
			application: Array<{ value: string; question: { title: string; order: number } }>;
		};
		onDecision: (decision: DecisionStatus) => void;
		decisionLoading: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
		lockState: ReviewPhase;
		claimerName: string | null;
		lockFreed: boolean;
		onReclaim: () => void;
	} = $props();

	// No banner while we hold it or are acquiring it — avoids a layout shift on
	// every applicant switch.
	let banner = $derived.by(() => {
		if (lockState === 'locked') {
			return lockFreed ? 'No longer being reviewed. Claim it to make a decision.' : null; // rendered with the claimer's name emphasised below
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

	let sortedResponses = $derived(
		[...applicant.application].sort((a, b) => a.question.order - b.question.order)
	);
</script>

<div class="flex h-full flex-col">
	<!-- Read-only banner -->
	{#if showBanner}
		<div
			class="flex shrink-0 items-center gap-2 border-b border-[#fde68a] bg-[#fffbeb] px-5 py-2.5"
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

	<!-- Header -->
	<div class="shrink-0 border-b border-border px-6 pt-5 pb-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<div class="text-[18px] leading-[1.2] font-bold text-primary">
					{applicant.name}
				</div>
				<div class="mt-[3px] text-[13px] text-muted-foreground">{applicant.email}</div>
			</div>
			<div class="flex shrink-0 flex-wrap justify-end gap-1.5">
				<BlacklistBadge match={applicant.blacklistMatch} size="md" />
				<span
					class="inline-block rounded bg-[#f0f0f0] px-2 py-[3px] text-[11px] font-semibold tracking-[0.04em] text-[#555] uppercase"
				>
					{roleLabel(applicant.role)}
				</span>
				{#if applicant.pendingDecision}
					<span
						class="inline-block rounded px-2 py-[3px] text-[11px] font-semibold {DECISION_CLASS[
							applicant.pendingDecision
						] ?? 'bg-[#e5e7eb] text-[#374151]'}"
					>
						Pending: {decLabel(applicant.pendingDecision)}
					</span>
				{/if}
				{#if applicant.activeDecision}
					<span
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

	<!-- Info grid -->
	<div class="grid shrink-0 grid-cols-2 gap-3 border-b border-[#f0f0f0] px-6 py-4">
		<div>
			<div class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Role
			</div>
			<div class="text-[13px] text-[#333]">
				{roleLabel(applicant.role)}
			</div>
		</div>
		<div>
			<div class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Status
			</div>
			<div class="text-[13px] text-[#333]">
				{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase().replace(/_/g, ' ')}
			</div>
		</div>
		<div>
			<div class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Applied
			</div>
			<div class="font-mono text-[13px] text-[#333]">
				{formatDate(applicant.createdAt)}
			</div>
		</div>
		<div>
			<div class="mb-[3px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				UID
			</div>
			<div class="font-mono text-[11px] break-all text-muted-foreground">
				{applicant.uid}
			</div>
		</div>
	</div>

	<!-- Application responses -->
	<div class="flex-1 overflow-y-auto px-6 py-5">
		{#if sortedResponses.length === 0}
			<div class="text-[13px] text-muted-foreground italic">No application responses.</div>
		{:else}
			<div class="mb-[14px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Application Responses
			</div>
			<div class="flex flex-col gap-5">
				{#each sortedResponses as response (response.question.title)}
					<div>
						<div class="mb-1.5 text-xs font-semibold text-[#555]">
							{response.question.title}
						</div>
						<div
							class="rounded border border-border bg-[#f9f9f9] px-3 py-[10px] text-[13px] leading-[1.5] break-words whitespace-pre-wrap text-primary"
						>
							{response.value || '—'}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Decision bar -->
	<DecisionBar
		pendingDecision={applicant.pendingDecision}
		{onDecision}
		loading={decisionLoading}
		{hasPrev}
		{hasNext}
		{onPrev}
		{onNext}
		{lockState}
		{claimerName}
		{lockFreed}
		{onReclaim}
	/>
</div>
