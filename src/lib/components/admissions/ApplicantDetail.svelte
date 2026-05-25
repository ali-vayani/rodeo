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

	const DECISION_BG: Record<string, string> = {
		ACCEPTED: '#d1fae5',
		WAITLISTED: '#fef9c3',
		REJECTED: '#fee2e2',
		PENDING: '#e5e7eb'
	};
	const DECISION_FG: Record<string, string> = {
		ACCEPTED: '#065f46',
		WAITLISTED: '#713f12',
		REJECTED: '#991b1b',
		PENDING: '#374151'
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

<div style="display:flex; flex-direction:column; height:100%;">
	<!-- Header -->
	<div style="padding:20px 24px 16px; border-bottom:1px solid #e0e0e0; flex-shrink:0;">
		<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
			<div>
				<div style="font-size:18px; font-weight:700; color:#191919; line-height:1.2;">
					{applicant.name}
				</div>
				<div style="font-size:13px; color:#aaaaaa; margin-top:3px;">{applicant.email}</div>
			</div>
			<div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; flex-shrink:0;">
				{#if applicant.roles.length}
					<span
						style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; background:#f0f0f0; color:#555;"
					>
						{roleLabel(applicant.roles[0])}
					</span>
				{/if}
				{#if applicant.pendingDecision}
					<span
						style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[applicant.pendingDecision] ?? '#e5e7eb'}; color:{DECISION_FG[applicant.pendingDecision] ?? '#374151'};"
					>
						Pending: {decLabel(applicant.pendingDecision)}
					</span>
				{/if}
				{#if applicant.activeDecision}
					<span
						style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600; background:{DECISION_BG[applicant.activeDecision] ?? '#e5e7eb'}; color:{DECISION_FG[applicant.activeDecision] ?? '#374151'}; opacity:0.7;"
					>
						Active: {decLabel(applicant.activeDecision)}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Info grid -->
	<div
		style="padding:16px 24px; border-bottom:1px solid #f0f0f0; flex-shrink:0; display:grid; grid-template-columns:1fr 1fr; gap:12px;"
	>
		<div>
			<div
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
			>
				Role
			</div>
			<div style="font-size:13px; color:#333;">
				{applicant.roles.length ? roleLabel(applicant.roles[0]) : '—'}
			</div>
		</div>
		<div>
			<div
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
			>
				Status
			</div>
			<div style="font-size:13px; color:#333;">
				{applicant.status.charAt(0) + applicant.status.slice(1).toLowerCase().replace(/_/g, ' ')}
			</div>
		</div>
		<div>
			<div
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
			>
				Applied
			</div>
			<div style="font-size:13px; color:#333; font-family:'DM Mono', monospace;">
				{formatDate(applicant.createdAt)}
			</div>
		</div>
		<div>
			<div
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:3px;"
			>
				UID
			</div>
			<div
				style="font-size:11px; color:#aaaaaa; font-family:'DM Mono', monospace; word-break:break-all;"
			>
				{applicant.uid}
			</div>
		</div>
	</div>

	<!-- Application responses -->
	<div style="flex:1; overflow-y:auto; padding:20px 24px;">
		{#if sortedResponses.length === 0}
			<div style="font-size:13px; color:#aaaaaa; font-style:italic;">No application responses.</div>
		{:else}
			<div
				style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-bottom:14px;"
			>
				Application Responses
			</div>
			<div style="display:flex; flex-direction:column; gap:20px;">
				{#each sortedResponses as response (response.question.title)}
					<div>
						<div style="font-size:12px; font-weight:600; color:#555; margin-bottom:6px;">
							{response.question.title}
						</div>
						<div
							style="font-size:13px; color:#191919; background:#f9f9f9; border:1px solid #e0e0e0; border-radius:5px; padding:10px 12px; white-space:pre-wrap; word-break:break-word; line-height:1.5;"
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
	/>
</div>
