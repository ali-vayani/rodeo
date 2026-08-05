<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import type { EventInput } from '$lib/schedule/types';
	import EventForm from './EventForm.svelte';

	let {
		event,
		timezone,
		defaultDayKey,
		saving = false,
		onSubmit,
		onCancel
	}: {
		event: Schedule;
		timezone: string;
		defaultDayKey: string;
		saving?: boolean;
		onSubmit: (input: EventInput) => void;
		onCancel: () => void;
	} = $props();
</script>

<!-- Same shell as DeleteEventDialog and IdleWarningModal so the app's modals match.
     EventForm supplies its own header bar and footer buttons, so it renders `bare`
     and this panel provides only the surface. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6"
	onclick={(e) => e.target === e.currentTarget && !saving && onCancel()}
	onkeydown={(e) => e.key === 'Escape' && !saving && onCancel()}
>
	<div
		role="dialog"
		aria-modal="true"
		aria-label="Edit event"
		class="max-h-full w-[560px] max-w-[calc(100vw-48px)] overflow-y-auto rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
	>
		<EventForm bare {event} {timezone} {defaultDayKey} {saving} {onSubmit} {onCancel} />
	</div>
</div>
