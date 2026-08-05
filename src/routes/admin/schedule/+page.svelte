<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { dayKey, nextDayKey, formatDayLabel } from '$lib/schedule/days';
	import { OTHER_DAY, type DayTab, type EventInput } from '$lib/schedule/types';
	import DayToggle from '$lib/components/schedule/DayToggle.svelte';
	import EventCard from '$lib/components/schedule/EventCard.svelte';
	import EventForm from '$lib/components/schedule/EventForm.svelte';
	import EventModal from '$lib/components/schedule/EventModal.svelte';
	import DeleteEventDialog from '$lib/components/schedule/DeleteEventDialog.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();
	const timezone = untrack(() => data.timezone);

	// The two hackathon days, derived from Settings.hackathonStartDate rather than
	// hardcoded. Both are fixed for the life of the page — a new start date only
	// arrives on reload.
	const day1 = untrack(() => dayKey(new Date(data.hackathonStartDate), timezone));
	const day2 = nextDayKey(day1);

	function sortByStart(list: Schedule[]): Schedule[] {
		return [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
	}

	function bucketOf(event: Schedule): string {
		const key = dayKey(event.start, timezone);
		return key === day1 || key === day2 ? key : OTHER_DAY;
	}

	let events = $state<Schedule[]>(untrack(() => sortByStart(data.events)));
	let selectedDay = $state(day1);

	// Adding uses the inline form; editing opens a modal over it. They're tracked
	// separately so an open add form can't be hijacked into an update.
	let addOpen = $state(false);
	let creating = $state(false);
	let editing = $state<Schedule | null>(null);
	let updating = $state(false);

	let deleteTarget = $state<Schedule | null>(null);
	let isDeleting = $state(false);

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let buckets = $derived.by(() => {
		const grouped: Record<string, Schedule[]> = { [day1]: [], [day2]: [], [OTHER_DAY]: [] };
		for (const event of events) grouped[bucketOf(event)].push(event);
		return grouped;
	});

	// The "Other" tab only appears when something actually falls outside the two
	// hackathon days — otherwise a mistyped year would leave an event invisible
	// and impossible to delete.
	let days = $derived<DayTab[]>([
		{ key: day1, label: 'Day 1', sublabel: formatDayLabel(day1) },
		{ key: day2, label: 'Day 2', sublabel: formatDayLabel(day2) },
		...(buckets[OTHER_DAY].length
			? [{ key: OTHER_DAY, label: 'Other', sublabel: 'off-schedule' }]
			: [])
	]);

	let counts = $derived(
		Object.fromEntries(Object.entries(buckets).map(([key, list]) => [key, list.length]))
	);

	let visibleEvents = $derived(buckets[selectedDay] ?? []);

	$effect(() => {
		// Deleting the last stray event removes the tab it was under.
		if (selectedDay === OTHER_DAY && buckets[OTHER_DAY].length === 0) selectedDay = day1;
	});

	/** The day a new event prefills onto, so adding a run of events doesn't mean retyping the date. */
	let defaultDayKey = $derived(selectedDay === OTHER_DAY ? day1 : selectedDay);

	/** Follow an event to whichever day it landed on, so it never saves out of sight. */
	function revealDay(event: Schedule) {
		selectedDay = bucketOf(event);
	}

	async function handleCreate(input: EventInput) {
		creating = true;
		try {
			const created = await trpc.schedule.create.mutate(input);
			events = sortByStart([...events, created]);
			revealDay(created);
			showToast('Event added');
			addOpen = false;
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to add event', 'error');
		} finally {
			creating = false;
		}
	}

	async function handleUpdate(input: EventInput) {
		if (!editing) return;
		updating = true;
		try {
			const updated = await trpc.schedule.update.mutate({ id: editing.id, ...input });
			events = sortByStart(events.map((e) => (e.id === updated.id ? updated : e)));
			revealDay(updated);
			showToast('Event updated');
			editing = null;
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to save changes', 'error');
		} finally {
			updating = false;
		}
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		isDeleting = true;
		try {
			const { id } = deleteTarget;
			await trpc.schedule.delete.mutate({ id });
			events = events.filter((e) => e.id !== id);
			if (editing?.id === id) editing = null;
			deleteTarget = null;
			showToast('Event deleted');
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to delete event', 'error');
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:head>
	<title>Schedule · Rodeo Admin</title>
</svelte:head>

<div class="max-w-[860px]">
	<!-- Page header -->
	<div class="mb-4 flex items-center justify-between">
		<div>
			<h1 class="text-[22px] font-bold text-primary">Schedule</h1>
			<span class="mt-0.5 block text-[13px] text-muted-foreground">
				{events.length}
				{events.length === 1 ? 'event' : 'events'} across the hackathon
			</span>
		</div>
		{#if !addOpen}
			<button
				onclick={() => (addOpen = true)}
				class="shrink-0 cursor-pointer rounded-md border border-primary bg-primary px-[18px] py-2 text-[13px] font-semibold text-white"
			>
				+ Add Event
			</button>
		{/if}
	</div>

	<DayToggle {days} selected={selectedDay} {counts} onSelect={(key) => (selectedDay = key)} />

	{#if addOpen}
		<!-- Keyed on the selected day so switching tabs re-seeds the date prefill. -->
		{#key selectedDay}
			<EventForm
				{timezone}
				{defaultDayKey}
				saving={creating}
				onSubmit={handleCreate}
				onCancel={() => (addOpen = false)}
			/>
		{/key}
	{/if}

	<!-- Event list -->
	<div class="overflow-hidden rounded-md border border-border bg-white">
		<div class="flex items-center justify-between border-b border-border bg-muted px-4 py-[9px]">
			<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				{selectedDay === OTHER_DAY ? 'Outside the hackathon dates' : 'Timeline'}
			</span>
			{#if visibleEvents.length > 0}
				<span
					class="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
				>
					{visibleEvents.length}
				</span>
			{/if}
		</div>

		{#if visibleEvents.length === 0}
			<div class="px-4 py-8 text-center text-[13px] text-muted-foreground">
				No events scheduled for this day.
			</div>
		{:else}
			{#each visibleEvents as event (event.id)}
				<EventCard
					{event}
					{timezone}
					onEdit={(e) => (editing = e)}
					onDelete={(e) => (deleteTarget = e)}
				/>
			{/each}
		{/if}
	</div>
</div>

{#if editing}
	<!-- Keyed on the event id so opening a different row remounts with its values. -->
	{#key editing.id}
		<EventModal
			event={editing}
			{timezone}
			{defaultDayKey}
			saving={updating}
			onSubmit={handleUpdate}
			onCancel={() => (editing = null)}
		/>
	{/key}
{/if}

{#if deleteTarget}
	<DeleteEventDialog
		event={deleteTarget}
		{timezone}
		{isDeleting}
		onConfirm={confirmDelete}
		onCancel={() => (deleteTarget = null)}
	/>
{/if}

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
