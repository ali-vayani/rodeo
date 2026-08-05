<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { formatTime } from '$lib/schedule/days';

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

<div
	class="grid grid-cols-[100px_1fr_auto] items-start gap-3 border-b border-[#f0f0f0] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#fafafa]"
>
	<!-- Time. The spec shows a single start time, but the schema stores an end too,
	     so it goes on a second line rather than being dropped. -->
	<div class="pt-px font-mono text-[12px] text-muted-foreground">
		<div class="text-primary">{formatTime(event.start, timezone)}</div>
		<div class="text-[11px]">– {formatTime(event.end, timezone)}</div>
	</div>

	<div class="min-w-0">
		<div class="text-[14px] font-semibold break-words text-primary">{event.name}</div>
		<div class="mt-0.5 text-[12px] break-words text-muted-foreground">{event.location}</div>
		{#if event.description}
			<div class="mt-1 text-[12px] leading-[1.5] break-words text-muted-foreground">
				{event.description}
			</div>
		{/if}
		<span
			class="mt-1.5 inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lowercase"
		>
			{event.type}
		</span>
	</div>

	<div class="flex shrink-0 items-center gap-2">
		<button
			onclick={() => onEdit(event)}
			class="cursor-pointer rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-muted"
		>
			Edit
		</button>
		<button
			onclick={() => onDelete(event)}
			class="cursor-pointer rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-destructive transition-colors hover:bg-[#fff1f2]"
		>
			Delete
		</button>
	</div>
</div>
