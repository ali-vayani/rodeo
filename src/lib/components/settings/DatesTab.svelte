<script lang="ts">
	import { untrack } from 'svelte';
	import { toDatetimeLocal } from '$lib/utils';

	let {
		applicationOpen,
		applicationDeadline,
		admissionsSend,
		RSVPDeadline,
		hackathonStartDate,
		saving,
		onSave
	}: {
		applicationOpen: Date;
		applicationDeadline: Date;
		admissionsSend: Date | null;
		RSVPDeadline: Date;
		hackathonStartDate: Date;
		saving: boolean;
		onSave: (updates: {
			applicationOpen: Date;
			applicationDeadline: Date;
			admissionsSend: Date | null;
			RSVPDeadline: Date;
			hackathonStartDate: Date;
		}) => void;
	} = $props();

	let appOpen = $state(untrack(() => toDatetimeLocal(applicationOpen)));
	let appClose = $state(untrack(() => toDatetimeLocal(applicationDeadline)));
	let decisionRelease = $state(untrack(() => toDatetimeLocal(admissionsSend)));
	let rsvpDeadline = $state(untrack(() => toDatetimeLocal(RSVPDeadline)));
	let eventStart = $state(untrack(() => toDatetimeLocal(hackathonStartDate)));

	// Each constraint is checked only when both of its dates are filled in.
	let errors = $derived({
		appOpen:
			appOpen && appClose && appOpen >= appClose ? 'Must be before Applications Close' : null,

		decisionRelease: decisionRelease
			? appClose && decisionRelease <= appClose
				? 'Must be after Applications Close'
				: rsvpDeadline && decisionRelease >= rsvpDeadline
					? 'Must be before RSVP Deadline'
					: null
			: null,

		rsvpDeadline:
			rsvpDeadline && appClose && rsvpDeadline <= appClose
				? 'Must be after Applications Close'
				: null,

		eventStart:
			eventStart && rsvpDeadline && eventStart <= rsvpDeadline
				? 'Must be after RSVP Deadline'
				: null
	});

	let hasErrors = $derived(Object.values(errors).some(Boolean));

	function handleSave() {
		if (hasErrors) return;
		onSave({
			applicationOpen: new Date(appOpen),
			applicationDeadline: new Date(appClose),
			admissionsSend: decisionRelease ? new Date(decisionRelease) : null,
			RSVPDeadline: new Date(rsvpDeadline),
			hackathonStartDate: new Date(eventStart)
		});
	}
</script>

<div class="max-w-[560px]">
	<div class="mb-5 space-y-4">
		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Applications Open
			</div>
			<input
				type="datetime-local"
				bind:value={appOpen}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.appOpen
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.appOpen}
				<div class="mt-1 text-xs text-destructive">{errors.appOpen}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Applications Close
			</div>
			<input
				type="datetime-local"
				bind:value={appClose}
				class="w-full rounded border border-border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none"
			/>
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Decision Release
				<span class="font-normal tracking-normal text-muted-foreground normal-case">
					— optional</span
				>
			</div>
			<div class="mb-1.5 text-xs text-muted-foreground">
				Must fall after Applications Close and before RSVP Deadline.
			</div>
			<input
				type="datetime-local"
				bind:value={decisionRelease}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.decisionRelease
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.decisionRelease}
				<div class="mt-1 text-xs text-destructive">{errors.decisionRelease}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				RSVP Deadline
			</div>
			<input
				type="datetime-local"
				bind:value={rsvpDeadline}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.rsvpDeadline
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.rsvpDeadline}
				<div class="mt-1 text-xs text-destructive">{errors.rsvpDeadline}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Event Start
			</div>
			<input
				type="datetime-local"
				bind:value={eventStart}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.eventStart
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.eventStart}
				<div class="mt-1 text-xs text-destructive">{errors.eventStart}</div>
			{/if}
		</div>
	</div>

	<button
		onclick={handleSave}
		disabled={saving || hasErrors}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Dates'}
	</button>
</div>
