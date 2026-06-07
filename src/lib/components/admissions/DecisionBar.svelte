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

<div class="flex items-center justify-between px-5 py-3 border-t border-border bg-white shrink-0">
	<!-- Prev / Next -->
	<div class="flex gap-1.5">
		<button
			onclick={onPrev}
			disabled={!hasPrev || loading}
			class="text-[13px] font-medium py-[7px] px-[13px] rounded border border-border bg-white {!hasPrev ? 'text-[#ccc] cursor-default' : 'text-primary cursor-pointer'}"
		>
			← Prev
		</button>
		<button
			onclick={onNext}
			disabled={!hasNext || loading}
			class="text-[13px] font-medium py-[7px] px-[13px] rounded border border-border bg-white {!hasNext ? 'text-[#ccc] cursor-default' : 'text-primary cursor-pointer'}"
		>
			Next →
		</button>
	</div>

	<!-- Decision buttons -->
	<div class="flex gap-2">
		<button
			onclick={() => onDecision('ACCEPTED')}
			disabled={loading || pendingDecision === 'ACCEPTED'}
			class="text-[13px] font-semibold py-2 px-[18px] rounded cursor-pointer transition-opacity {pendingDecision === 'ACCEPTED' ? 'bg-[#d1fae5] text-[#065f46] border border-[#6ee7b7] opacity-70 cursor-default' : 'bg-primary text-white border border-primary'} {loading ? 'opacity-50 cursor-default' : ''}"
		>
			Accept
		</button>
		<button
			onclick={() => onDecision('WAITLISTED')}
			disabled={loading || pendingDecision === 'WAITLISTED'}
			class="text-[13px] font-medium py-2 px-[18px] rounded cursor-pointer transition-opacity {pendingDecision === 'WAITLISTED' ? 'bg-[#fef9c3] text-[#713f12] border border-[#fde68a] opacity-70 cursor-default' : 'bg-white text-primary border border-border'} {loading ? 'opacity-50 cursor-default' : ''}"
		>
			Waitlist
		</button>
		<button
			onclick={() => onDecision('REJECTED')}
			disabled={loading || pendingDecision === 'REJECTED'}
			class="text-[13px] font-medium py-2 px-[18px] rounded cursor-pointer transition-opacity {pendingDecision === 'REJECTED' ? 'bg-[#fee2e2] text-[#991b1b] border border-[#fca5a5] opacity-70 cursor-default' : 'bg-white text-muted-foreground border border-border'} {loading ? 'opacity-50 cursor-default' : ''}"
		>
			Reject
		</button>
	</div>
</div>
