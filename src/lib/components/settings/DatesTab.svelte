<script lang="ts">
	import { untrack } from 'svelte';

	function toDatetimeLocal(d: Date | null | undefined): string {
		if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

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

	// Derived validation errors — only check a constraint when both dates are filled in
	let errors = $derived({
		appOpen:
			appOpen && appClose && appOpen >= appClose
				? 'Must be before Applications Close'
				: null,

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
	<div class="space-y-4 mb-5">
		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
				Applications Open
			</div>
			<input
				type="datetime-local"
				bind:value={appOpen}
				class="w-full text-[13px] text-primary bg-white border rounded px-3 py-[7px] outline-none font-mono {errors.appOpen ? 'border-destructive' : 'border-border'}"
			/>
			{#if errors.appOpen}
				<div class="text-xs text-destructive mt-1">{errors.appOpen}</div>
			{/if}
		</div>

		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
				Applications Close
			</div>
			<input
				type="datetime-local"
				bind:value={appClose}
				class="w-full text-[13px] text-primary bg-white border border-border rounded px-3 py-[7px] outline-none font-mono"
			/>
		</div>

		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
				Decision Release
				<span class="font-normal normal-case tracking-normal text-muted-foreground"> — optional</span>
			</div>
			<div class="text-xs text-muted-foreground mb-1.5">
				Must fall after Applications Close and before RSVP Deadline.
			</div>
			<input
				type="datetime-local"
				bind:value={decisionRelease}
				class="w-full text-[13px] text-primary bg-white border rounded px-3 py-[7px] outline-none font-mono {errors.decisionRelease ? 'border-destructive' : 'border-border'}"
			/>
			{#if errors.decisionRelease}
				<div class="text-xs text-destructive mt-1">{errors.decisionRelease}</div>
			{/if}
		</div>

		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
				RSVP Deadline
			</div>
			<input
				type="datetime-local"
				bind:value={rsvpDeadline}
				class="w-full text-[13px] text-primary bg-white border rounded px-3 py-[7px] outline-none font-mono {errors.rsvpDeadline ? 'border-destructive' : 'border-border'}"
			/>
			{#if errors.rsvpDeadline}
				<div class="text-xs text-destructive mt-1">{errors.rsvpDeadline}</div>
			{/if}
		</div>

		<div>
			<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
				Event Start
			</div>
			<input
				type="datetime-local"
				bind:value={eventStart}
				class="w-full text-[13px] text-primary bg-white border rounded px-3 py-[7px] outline-none font-mono {errors.eventStart ? 'border-destructive' : 'border-border'}"
			/>
			{#if errors.eventStart}
				<div class="text-xs text-destructive mt-1">{errors.eventStart}</div>
			{/if}
		</div>
	</div>

	<button
		onclick={handleSave}
		disabled={saving || hasErrors}
		class="text-[13px] font-semibold text-white bg-primary border-none rounded-md py-[9px] px-[18px] cursor-pointer disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Dates'}
	</button>
</div>
