<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { formatTime } from '$lib/schedule/days';
	import { Badge, Button } from '$lib/components/ui';
	import { scheduleTypeTone } from '$lib/ui/tone';
	import { humanizeEnum } from '$lib/format';

	let {
		event,
		timezone,
		onEdit,
		onDelete
	}: {
		event: Schedule;
		timezone: string;
		onEdit: (event: Schedule) => void;
		onDelete: (event: Schedule) => void;
	} = $props();
</script>

<!-- Below sm there's no room for three columns: time and actions share the
     first row and the event details take a full-width second row. From sm up
     the original three-column grid returns unchanged. -->
<div
	class="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-border-subtle px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-surface-hover sm:grid sm:grid-cols-[100px_1fr_auto] sm:gap-3"
>
	<!-- Time. The spec shows a single start time, but the schema stores an end too,
	     so it goes on a second line rather than being dropped. -->
	<div class="pt-px font-mono text-sm text-foreground-secondary tabular-nums">
		<div class="text-foreground">{formatTime(event.start, timezone)}</div>
		<div class="text-xs">– {formatTime(event.end, timezone)}</div>
	</div>

	<div class="order-last w-full min-w-0 sm:order-none sm:w-auto">
		<div class="text-md font-semibold break-words text-foreground">{event.name}</div>
		<div class="mt-0.5 text-sm break-words text-foreground-secondary">{event.location}</div>
		{#if event.description}
			<div class="mt-1 text-sm break-words text-foreground-secondary">{event.description}</div>
		{/if}
		<div class="mt-1.5">
			<Badge tone={scheduleTypeTone(event.type)}>{humanizeEnum(event.type)}</Badge>
		</div>
	</div>

	<div class="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
		<Button size="sm" onclick={() => onEdit(event)}>Edit</Button>
		<Button size="sm" variant="ghost" onclick={() => onDelete(event)} class="text-destructive">
			Delete
		</Button>
	</div>
</div>
