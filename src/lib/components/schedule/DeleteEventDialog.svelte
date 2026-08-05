<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import { formatTime } from '$lib/schedule/days';

	let {
		event,
		timezone,
		isDeleting = false,
		onConfirm,
		onCancel
	}: {
		event: Schedule;
		timezone: string;
		isDeleting?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let cancelBtn = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		cancelBtn?.focus();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45"
	onclick={(e) => e.target === e.currentTarget && onCancel()}
	onkeydown={(e) => e.key === 'Escape' && onCancel()}
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="delete-event-title"
		class="w-[440px] max-w-[calc(100vw-48px)] overflow-hidden rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
	>
		<div class="border-b border-border px-6 pt-5 pb-4">
			<div id="delete-event-title" class="text-[16px] font-bold text-primary">Delete event?</div>
			<div class="mt-1 text-[13px] text-muted-foreground">This can't be undone.</div>
		</div>

		<div class="px-6 py-5">
			<div class="rounded border border-border bg-muted px-[14px] py-3">
				<div class="text-[13px] font-semibold text-primary">{event.name}</div>
				<div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
					{formatTime(event.start, timezone)} – {formatTime(event.end, timezone)} · {event.location}
				</div>
			</div>
		</div>

		<div class="flex justify-end gap-[10px] border-t border-border px-6 py-4">
			<button
				bind:this={cancelBtn}
				onclick={onCancel}
				class="cursor-pointer rounded-md border border-border bg-white px-4 py-2 text-[13px] font-medium text-primary"
			>
				Cancel
			</button>
			<button
				onclick={onConfirm}
				disabled={isDeleting}
				class="cursor-pointer rounded-md border border-destructive bg-destructive px-[18px] py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
			>
				{isDeleting ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	</div>
</div>
