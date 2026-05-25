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

<div
	style="display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-top:1px solid #e0e0e0; background:#fff; flex-shrink:0;"
>
	<!-- Prev / Next -->
	<div style="display:flex; gap:6px;">
		<button
			onclick={onPrev}
			disabled={!hasPrev || loading}
			style="font-size:13px; font-weight:500; padding:7px 13px; border-radius:5px; border:1px solid #e0e0e0; background:#fff; color:{!hasPrev ? '#cccccc' : '#191919'}; cursor:{!hasPrev ? 'default' : 'pointer'};"
		>
			← Prev
		</button>
		<button
			onclick={onNext}
			disabled={!hasNext || loading}
			style="font-size:13px; font-weight:500; padding:7px 13px; border-radius:5px; border:1px solid #e0e0e0; background:#fff; color:{!hasNext ? '#cccccc' : '#191919'}; cursor:{!hasNext ? 'default' : 'pointer'};"
		>
			Next →
		</button>
	</div>

	<!-- Decision buttons -->
	<div style="display:flex; gap:8px;">
		<button
			onclick={() => onDecision('ACCEPTED')}
			disabled={loading || pendingDecision === 'ACCEPTED'}
			style="font-size:13px; font-weight:600; padding:8px 18px; border-radius:5px; cursor:pointer; transition:opacity 0.1s;
				{pendingDecision === 'ACCEPTED'
				? 'background:#d1fae5; color:#065f46; border:1px solid #6ee7b7; opacity:0.7; cursor:default;'
				: 'background:#191919; color:#fff; border:1px solid #191919;'}
				{loading ? 'opacity:0.5; cursor:default;' : ''}"
		>
			Accept
		</button>
		<button
			onclick={() => onDecision('WAITLISTED')}
			disabled={loading || pendingDecision === 'WAITLISTED'}
			style="font-size:13px; font-weight:500; padding:8px 18px; border-radius:5px; cursor:pointer; transition:opacity 0.1s;
				{pendingDecision === 'WAITLISTED'
				? 'background:#fef9c3; color:#713f12; border:1px solid #fde68a; opacity:0.7; cursor:default;'
				: 'background:#fff; color:#191919; border:1px solid #e0e0e0;'}
				{loading ? 'opacity:0.5; cursor:default;' : ''}"
		>
			Waitlist
		</button>
		<button
			onclick={() => onDecision('REJECTED')}
			disabled={loading || pendingDecision === 'REJECTED'}
			style="font-size:13px; font-weight:500; padding:8px 18px; border-radius:5px; cursor:pointer; transition:opacity 0.1s;
				{pendingDecision === 'REJECTED'
				? 'background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; opacity:0.7; cursor:default;'
				: 'background:#fff; color:#aaaaaa; border:1px solid #e0e0e0;'}
				{loading ? 'opacity:0.5; cursor:default;' : ''}"
		>
			Reject
		</button>
	</div>
</div>
