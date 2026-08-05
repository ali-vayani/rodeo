<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { formatTime } from '$lib/schedule/days';
	import { ConfirmDialog } from '$lib/components/patterns';

	let {
		open = $bindable(false),
		event,
		timezone,
		isDeleting = false,
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		event: Schedule;
		timezone: string;
		isDeleting?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<ConfirmDialog
	bind:open
	title="Delete event?"
	description="This can't be undone."
	confirmLabel="Delete"
	loading={isDeleting}
	{onConfirm}
	{onCancel}
>
	<div class="rounded-md border border-border bg-muted px-3.5 py-3">
		<div class="text-base font-semibold text-foreground">{event.name}</div>
		<div class="mt-0.5 font-mono text-xs text-foreground-secondary">
			{formatTime(event.start, timezone)} – {formatTime(event.end, timezone)} · {event.location}
		</div>
	</div>
</ConfirmDialog>
