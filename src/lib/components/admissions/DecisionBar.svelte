<script lang="ts">
	let {
		pendingDecision,
		onDecision,
		loading,
		hasPrev,
		hasNext,
		onPrev,
		onNext
	}: {
		pendingDecision: string | null;
		onDecision: (decision: string) => void;
		loading: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
	} = $props();
</script>

<div class="flex shrink-0 items-center justify-between border-t border-border bg-white px-5 py-3">
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
	<div class="flex gap-2">
		<button
			onclick={() => onDecision('ACCEPTED')}
			disabled={loading || pendingDecision === 'ACCEPTED'}
			class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-semibold transition-opacity {pendingDecision ===
			'ACCEPTED'
				? 'cursor-default border border-[#6ee7b7] bg-[#d1fae5] text-[#065f46] opacity-70'
				: 'border border-primary bg-primary text-white'} {loading
				? 'cursor-default opacity-50'
				: ''}"
		>
			Accept
		</button>
		<button
			onclick={() => onDecision('WAITLISTED')}
			disabled={loading || pendingDecision === 'WAITLISTED'}
			class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-medium transition-opacity {pendingDecision ===
			'WAITLISTED'
				? 'cursor-default border border-[#fde68a] bg-[#fef9c3] text-[#713f12] opacity-70'
				: 'border border-border bg-white text-primary'} {loading
				? 'cursor-default opacity-50'
				: ''}"
		>
			Waitlist
		</button>
		<button
			onclick={() => onDecision('REJECTED')}
			disabled={loading || pendingDecision === 'REJECTED'}
			class="cursor-pointer rounded px-[18px] py-2 text-[13px] font-medium transition-opacity {pendingDecision ===
			'REJECTED'
				? 'cursor-default border border-[#fca5a5] bg-[#fee2e2] text-[#991b1b] opacity-70'
				: 'border border-border bg-white text-muted-foreground'} {loading
				? 'cursor-default opacity-50'
				: ''}"
		>
			Reject
		</button>
	</div>
</div>
