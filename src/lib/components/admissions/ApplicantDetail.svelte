<script lang="ts">
	import DecisionBar from './DecisionBar.svelte';

	let {
		applicant,
		onDecision,
		decisionLoading,
		hasPrev,
		hasNext,
		onPrev,
		onNext
	}: {
		applicant: {
			uid: string;
			name: string;
			email: string;
			roles: string[];
			status: string;
			pendingDecision: string | null;
			activeDecision: string | null;
			createdAt: Date | string;
			application: Array<{ value: string; question: { title: string; order: number } }>;
		};
		onDecision: (decision: string) => void;
		decisionLoading: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		onPrev: () => void;
		onNext: () => void;
	} = $props();

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
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	let sortedResponses = $derived(
		[...applicant.application].sort((a, b) => a.question.order - b.question.order)
	);
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div class="px-6 pb-4 pt-5 border-b border-border shrink-0">
		<div class="flex items-start justify-between gap-3">
			<div>
				<div class="text-[18px] font-bold text-primary leading-[1.2]">
					{applicant.name}
				</div>
				<div class="text-[13px] text-muted-foreground mt-[3px]">{applicant.email}</div>
			</div>
			<div class="flex gap-1.5 flex-wrap justify-end shrink-0">
				{#if applicant.roles.length}
					<span class="inline-block px-2 py-[3px] rounded text-[11px] font-semibold tracking-[0.04em] uppercase bg-[#f0f0f0] text-[#555]">
						{roleLabel(applicant.roles[0])}
					</span>
				{/if}
				{#if applicant.pendingDecision}
					<span class="inline-block px-2 py-[3px] rounded text-[11px] font-semibold {DECISION_CLASS[applicant.pendingDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
						Pending: {decLabel(applicant.pendingDecision)}
					</span>
				{/if}
				{#if applicant.activeDecision}
					<span class="inline-block px-2 py-[3px] rounded text-[11px] font-semibold opacity-70 {DECISION_CLASS[applicant.activeDecision] ?? 'bg-[#e5e7eb] text-[#374151]'}">
						Active: {decLabel(applicant.activeDecision)}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Info grid -->
	<div class="px-6 py-4 border-b border-[#f0f0f0] shrink-0 grid grid-cols-2 gap-3">
		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
				Role
			</div>
			<div class="text-[13px] text-[#333]">
				{applicant.roles.length ? roleLabel(applicant.roles[0]) : '—'}
			</div>
		</div>
		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
				Status
			</div>
			<div class="text-[13px] text-[#333]">
				{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase().replace(/_/g, ' ')}
			</div>
		</div>
		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
				Applied
			</div>
			<div class="text-[13px] text-[#333] font-mono">
				{formatDate(applicant.createdAt)}
			</div>
		</div>
		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[3px]">
				UID
			</div>
			<div class="text-[11px] text-muted-foreground font-mono break-all">
				{applicant.uid}
			</div>
		</div>
	</div>

	<!-- Application responses -->
	<div class="flex-1 overflow-y-auto px-6 py-5">
		{#if sortedResponses.length === 0}
			<div class="text-[13px] text-muted-foreground italic">No application responses.</div>
		{:else}
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-[14px]">
				Application Responses
			</div>
			<div class="flex flex-col gap-5">
				{#each sortedResponses as response (response.question.title)}
					<div>
						<div class="text-xs font-semibold text-[#555] mb-1.5">
							{response.question.title}
						</div>
						<div class="text-[13px] text-primary bg-[#f9f9f9] border border-border rounded px-3 py-[10px] whitespace-pre-wrap break-words leading-[1.5]">
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
	/>
</div>
