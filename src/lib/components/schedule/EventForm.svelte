<script lang="ts">
	import { untrack } from 'svelte';
	import { ScheduleType } from '$lib/generated/prisma/enums';
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import type { EventInput } from '$lib/schedule/types';
	import { toZonedInput, fromZonedInput } from '$lib/schedule/days';
	import { Button, Card, Combobox, Input, Textarea } from '$lib/components/ui';
	import { humanizeEnum } from '$lib/format';
	import { cn } from '$lib/utils';

	let {
		event = null,
		timezone,
		defaultDayKey,
		saving = false,
		bare = false,
		onSubmit,
		onCancel
	}: {
		/** The event being edited, or null when adding a new one. */
		event?: Schedule | null;
		/** Hackathon timezone from Settings — every field here is a wall clock in it. */
		timezone: string;
		/** `YYYY-MM-DD` the new-event prefill lands on. */
		defaultDayKey: string;
		saving?: boolean;
		/** Drop the card chrome — the modal wrapper supplies its own panel styling. */
		bare?: boolean;
		onSubmit: (input: EventInput) => void;
		onCancel: () => void;
	} = $props();

	const TYPE_OPTIONS = Object.values(ScheduleType).map((value) => ({
		value,
		label: humanizeEnum(value)
	}));

	// Snapshotted once per mount. The page keys this component on the event id so
	// switching between add and edit remounts it with fresh values.
	let name = $state(untrack(() => event?.name ?? ''));
	let location = $state(untrack(() => event?.location ?? ''));
	let description = $state(untrack(() => event?.description ?? ''));
	let type = $state<string>(untrack(() => event?.type ?? ScheduleType.EVENT));
	let start = $state(
		untrack(() => (event ? toZonedInput(event.start, timezone) : `${defaultDayKey}T12:00`))
	);
	let end = $state(
		untrack(() => (event ? toZonedInput(event.end, timezone) : `${defaultDayKey}T13:00`))
	);

	let errors = $derived({
		name: name.trim() ? null : 'Required',
		location: location.trim() ? null : 'Required',
		start: start ? null : 'Required',
		// Compares the raw datetime-local strings: both are the same fixed-width
		// format in the same zone, so lexical order matches chronological order.
		end: !end ? 'Required' : start && end <= start ? 'Must be after the start time' : null
	});

	let hasErrors = $derived(Object.values(errors).some(Boolean));

	// Errors only surface once a field has been touched or a submit was attempted,
	// so a fresh form isn't red before anyone has typed anything.
	let touched = $state<Record<string, boolean>>({});
	let submitted = $state(false);

	function shown(field: keyof typeof errors): string | null {
		return touched[field] || submitted ? errors[field] : null;
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		submitted = true;
		if (hasErrors || saving) return;
		onSubmit({
			name: name.trim(),
			description: description.trim() || undefined,
			// Read as wall clocks in the hackathon timezone, so what the admin typed is
			// what attendees see — regardless of where the admin happens to be sitting.
			start: fromZonedInput(start, timezone),
			end: fromZonedInput(end, timezone),
			location: location.trim(),
			type: type as ScheduleType
		});
	}
</script>

{#snippet fields()}
	<div class="flex flex-col gap-4 p-4">
		<!--
			autofocus reaches the real <input> through Input's ...rest. The compiler's
			a11y_autofocus check only inspects literal attributes on elements, so it
			no longer fires here — the tradeoff is deliberate either way: this form is
			the only thing on screen when it opens.
		-->
		<Input
			label="Title"
			required
			bind:value={name}
			placeholder="e.g. Workshop: Intro to ML"
			autofocus
			error={shown('name')}
			onblur={() => (touched.name = true)}
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<p class="m-0 -mb-2 text-xs text-foreground-secondary sm:col-span-2">
				Times are in <span class="font-mono text-foreground">{timezone}</span>, the hackathon
				timezone — not your computer's.
			</p>
			<Input
				label="Start"
				type="datetime-local"
				mono
				bind:value={start}
				error={shown('start')}
				onblur={() => (touched.start = true)}
			/>
			<Input
				label="End"
				type="datetime-local"
				mono
				bind:value={end}
				error={shown('end')}
				onblur={() => (touched.end = true)}
			/>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<Input
				label="Location"
				required
				bind:value={location}
				placeholder="Room 101"
				error={shown('location')}
				onblur={() => (touched.location = true)}
			/>
			<Combobox label="Type" options={TYPE_OPTIONS} bind:value={type} />
		</div>

		<Textarea
			label="Description"
			hint="Optional — shown alongside the event"
			bind:value={description}
			rows={2}
			placeholder="Shown alongside the event"
		/>
	</div>
{/snippet}

{#snippet actions()}
	<Button type="button" onclick={onCancel} disabled={saving}>Cancel</Button>
	<Button type="submit" variant="primary" disabled={hasErrors} loading={saving}>
		{event ? 'Save changes' : 'Add to schedule'}
	</Button>
{/snippet}

<form onsubmit={handleSubmit} class={cn(!bare && 'mb-4')}>
	{#if bare}
		{@render fields()}
		<div class="flex justify-end gap-2 border-t border-border px-4 py-3">
			{@render actions()}
		</div>
	{:else}
		<Card title={event ? 'Edit event' : 'New event'} padding="none">
			{@render fields()}
			{#snippet footer()}{@render actions()}{/snippet}
		</Card>
	{/if}
</form>
