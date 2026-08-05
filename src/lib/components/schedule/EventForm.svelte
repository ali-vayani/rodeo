<script lang="ts">
	import { untrack } from 'svelte';
	import { ScheduleType } from '$lib/generated/prisma/enums';
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import type { EventInput } from '$lib/schedule/types';
	import { toZonedInput, fromZonedInput } from '$lib/schedule/days';

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

	const TYPES = Object.values(ScheduleType);

	// Snapshotted once per mount. The page keys this component on the event id so
	// switching between add and edit remounts it with fresh values.
	let name = $state(untrack(() => event?.name ?? ''));
	let location = $state(untrack(() => event?.location ?? ''));
	let description = $state(untrack(() => event?.description ?? ''));
	let type = $state<ScheduleType>(untrack(() => event?.type ?? ScheduleType.EVENT));
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

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (hasErrors || saving) return;
		onSubmit({
			name: name.trim(),
			description: description.trim() || undefined,
			// Read as wall clocks in the hackathon timezone, so what the admin typed is
			// what attendees see — regardless of where the admin happens to be sitting.
			start: fromZonedInput(start, timezone),
			end: fromZonedInput(end, timezone),
			location: location.trim(),
			type
		});
	}

	const inputClass =
		'w-full rounded border bg-white px-3 py-[7px] text-[13px] text-primary outline-none';
	const labelClass = 'mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase';
</script>

<form
	onsubmit={handleSubmit}
	class={bare ? '' : 'mb-4 overflow-hidden rounded-md border border-border bg-white'}
>
	<div class="border-b border-border bg-muted px-4 py-[9px]">
		<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			{event ? 'Edit Event' : 'New Event'}
		</span>
	</div>

	<div class="space-y-4 p-4">
		<div>
			<div class={labelClass}>Title</div>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				bind:value={name}
				placeholder="e.g. Workshop: Intro to ML"
				autofocus
				class="{inputClass} {errors.name ? 'border-destructive' : 'border-border'}"
			/>
			{#if errors.name}<div class="mt-1 text-xs text-destructive">{errors.name}</div>{/if}
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="-mb-2 text-xs text-muted-foreground sm:col-span-2">
				Times are in <span class="font-mono text-primary">{timezone}</span>, the hackathon timezone
				— not your computer's.
			</div>
			<div>
				<div class={labelClass}>Start</div>
				<input
					type="datetime-local"
					bind:value={start}
					class="{inputClass} font-mono {errors.start ? 'border-destructive' : 'border-border'}"
				/>
				{#if errors.start}<div class="mt-1 text-xs text-destructive">{errors.start}</div>{/if}
			</div>
			<div>
				<div class={labelClass}>End</div>
				<input
					type="datetime-local"
					bind:value={end}
					class="{inputClass} font-mono {errors.end ? 'border-destructive' : 'border-border'}"
				/>
				{#if errors.end}<div class="mt-1 text-xs text-destructive">{errors.end}</div>{/if}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<div class={labelClass}>Location</div>
				<input
					type="text"
					bind:value={location}
					placeholder="Room 101"
					class="{inputClass} {errors.location ? 'border-destructive' : 'border-border'}"
				/>
				{#if errors.location}<div class="mt-1 text-xs text-destructive">{errors.location}</div>{/if}
			</div>
			<div>
				<div class={labelClass}>Type</div>
				<select bind:value={type} class="{inputClass} cursor-pointer border-border">
					{#each TYPES as t (t)}
						<option value={t}>{t.toLowerCase()}</option>
					{/each}
				</select>
			</div>
		</div>

		<div>
			<div class={labelClass}>
				Description
				<span class="font-normal tracking-normal normal-case"> — optional</span>
			</div>
			<textarea
				bind:value={description}
				rows="2"
				placeholder="Shown alongside the event"
				class="{inputClass} resize-y border-border"
			></textarea>
		</div>
	</div>

	<div class="flex justify-end gap-[10px] border-t border-border px-4 py-3">
		<button
			type="button"
			onclick={onCancel}
			class="cursor-pointer rounded-md border border-border bg-white px-4 py-2 text-[13px] font-medium text-primary"
		>
			Cancel
		</button>
		<button
			type="submit"
			disabled={hasErrors || saving}
			class="cursor-pointer rounded-md border border-primary bg-primary px-[18px] py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
		>
			{saving ? 'Saving…' : event ? 'Save Changes' : 'Add to Schedule'}
		</button>
	</div>
</form>
