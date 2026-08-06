<script lang="ts">
	import type { ReviewPhase } from '$lib/admissions/reviewSession.svelte';
	import type { DecisionStatus } from '$lib/generated/prisma/enums';

	let {
		pendingDecision,
		onDecision,
		loading,
		hasPrev,
		hasNext,
		onPrev,
		onNext,
		lockState,
		claimerName,
		lockFreed,
		onReclaim
	}: {
		pendingDecision: string | null;
		onDecision: (decision: DecisionStatus) => void;
		loading: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
		lockState: ReviewPhase;
		claimerName: string | null;
		lockFreed: boolean;
		onReclaim: () => void;
	} = $props();

	// While the claim is in flight, keep the decision buttons in place but dimmed.
	// Flashing the read-only strip on every applicant switch would train admins to
	// click through it, which is exactly the wrong reflex when the state is real.
	let showDecisions = $derived(lockState === 'owned' || lockState === 'acquiring');
	let busy = $derived(loading || lockState === 'acquiring');

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

	// While someone else genuinely holds the lock there is nothing to offer: the
	// server refuses any claim against a fresh lock, so a button here would be a
	// no-op that reads like a force-takeover. The presence poll flips this to a
	// real Claim button as soon as the lock is actually free.
	let showAction = $derived(lockState !== 'locked' || lockFreed);

	// "Resume review" and a freed "Claim" are the expected click — make them look it.
	let actionIsPrimary = $derived(lockState === 'expired' || (lockState === 'locked' && lockFreed));
</script>

<!-- Sticky below md so Accept/Waitlist/Reject stay reachable while the page
     scrolls through a long application; static from md up, where the detail
     pane scrolls internally and the bar is already pinned by the flex column. -->
<div
	class="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border bg-white px-4 py-3 sm:px-5 md:static md:z-auto"
>
	<!-- Prev / Next -->
	<div class="flex gap-1.5">
		<button
			onclick={onPrev}
			disabled={!hasPrev || loading}
			class="rounded border border-border bg-white px-[13px] py-[7px] text-[13px] font-medium {!hasPrev
				? 'cursor-default text-[#ccc]'
				: 'cursor-pointer text-primary'}"
		>
			← Prev
		</button>
		<button
			onclick={onNext}
			disabled={!hasNext || loading}
			class="rounded border border-border bg-white px-[13px] py-[7px] text-[13px] font-medium {!hasNext
				? 'cursor-default text-[#ccc]'
				: 'cursor-pointer text-primary'}"
		>
			Next →
		</button>
	</div>

	<!-- Decision buttons -->
	{#if !showDecisions}
		<div class="flex items-center gap-2">
			<span class="text-[12px] text-muted-foreground italic">{statusText}</span>
			{#if showAction}
				<button
					onclick={onReclaim}
					class="cursor-pointer rounded px-3 py-[6px] text-[12px] font-medium transition-colors {actionIsPrimary
						? 'border border-primary bg-primary text-white'
						: 'border border-border bg-white text-primary hover:bg-[#f5f5f5]'}"
				>
					{actionText}
				</button>
			{/if}
		</div>
	{:else}
		<div class="flex gap-2 max-md:w-full">
			<button
				onclick={() => onDecision('ACCEPTED')}
				disabled={busy || pendingDecision === 'ACCEPTED'}
				class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-semibold transition-opacity max-md:flex-1 {pendingDecision ===
				'ACCEPTED'
					? 'cursor-default border border-[#6ee7b7] bg-[#d1fae5] text-[#065f46] opacity-70'
					: 'border border-primary bg-primary text-white'} {busy
					? 'cursor-default opacity-50'
					: ''}"
			>
				Accept
			</button>
			<button
				onclick={() => onDecision('WAITLISTED')}
				disabled={busy || pendingDecision === 'WAITLISTED'}
				class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-medium transition-opacity max-md:flex-1 {pendingDecision ===
				'WAITLISTED'
					? 'cursor-default border border-[#fde68a] bg-[#fef9c3] text-[#713f12] opacity-70'
					: 'border border-border bg-white text-primary'} {busy ? 'cursor-default opacity-50' : ''}"
			>
				Waitlist
			</button>
			<button
				onclick={() => onDecision('REJECTED')}
				disabled={busy || pendingDecision === 'REJECTED'}
				class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-medium transition-opacity max-md:flex-1 {pendingDecision ===
				'REJECTED'
					? 'cursor-default border border-[#fca5a5] bg-[#fee2e2] text-[#991b1b] opacity-70'
					: 'border border-border bg-white text-muted-foreground'} {busy
					? 'cursor-default opacity-50'
					: ''}"
			>
				Reject
			</button>
		</div>
	{/if}
</div>
