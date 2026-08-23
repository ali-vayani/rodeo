<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { dayKey, nextDayKey, formatDayLabel } from '$lib/schedule/days';
	import { OTHER_DAY, type DayTab, type EventInput } from '$lib/schedule/types';
	import DayToggle from '$lib/components/schedule/DayToggle.svelte';
	import EventCard from '$lib/components/schedule/EventCard.svelte';
	import EventForm from '$lib/components/schedule/EventForm.svelte';
	import EventModal from '$lib/components/schedule/EventModal.svelte';
	import DeleteEventDialog from '$lib/components/schedule/DeleteEventDialog.svelte';
	import { Badge, Button, Card, EmptyState } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/patterns';
	import { toast } from '$lib/ui/toast.svelte';
	import { pluralize } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();
	const timezone = untrack(() => data.timezone);

	// The two hackathon days, derived from Settings.hackathonStartDate rather than
	// hardcoded. Both are fixed for the life of the page; a new start date only
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

	let buckets = $derived.by(() => {
		const grouped: Record<string, Schedule[]> = { [day1]: [], [day2]: [], [OTHER_DAY]: [] };
		for (const event of events) grouped[bucketOf(event)].push(event);
		return grouped;
	});

	// The "Other" tab only appears when something actually falls outside the two
	// hackathon days. Without it a mistyped year would leave an event invisible
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
			toast.success('Event added');
			addOpen = false;
		} catch (e) {
			toast.fromError(e, 'Failed to add event');
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
			toast.success('Event updated');
			editing = null;
		} catch (e) {
			toast.fromError(e, 'Failed to save changes');
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
			toast.success('Event deleted');
		} catch (e) {
			toast.fromError(e, 'Failed to delete event');
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:head>
	<title>Schedule · Rodeo Admin</title>
</svelte:head>

<div class="max-w-4xl">
	<PageHeader title="Schedule" subtitle="{pluralize(events.length, 'event')} across the hackathon">
		{#snippet actions()}
			{#if !addOpen}
				<Button variant="primary" onclick={() => (addOpen = true)}>+ Add event</Button>
			{/if}
		{/snippet}
	</PageHeader>

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

	<Card
		title={selectedDay === OTHER_DAY ? 'Outside the hackathon dates' : 'Timeline'}
		padding="none"
	>
		{#snippet actions()}
			{#if visibleEvents.length > 0}
				<Badge tone="neutral">{visibleEvents.length}</Badge>
			{/if}
		{/snippet}

		{#if visibleEvents.length === 0}
			<EmptyState message="No events scheduled for this day." />
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
	</Card>
</div>

{#if editing}
	<!-- Keyed on the event id so opening a different row remounts with its values. -->
	{#key editing.id}
		<EventModal
			open
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
		open
		event={deleteTarget}
		{timezone}
		{isDeleting}
		onConfirm={confirmDelete}
		onCancel={() => (deleteTarget = null)}
	/>
{/if}
