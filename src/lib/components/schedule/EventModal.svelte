<script lang="ts">
	import type { ScheduleModel as Schedule } from '$lib/generated/prisma/models';
	import type { EventInput } from '$lib/schedule/types';
	import { Modal } from '$lib/components/ui';
	import EventForm from './EventForm.svelte';

	let {
		open = $bindable(false),
		event,
		timezone,
		defaultDayKey,
		saving = false,
		onSubmit,
		onCancel
	}: {
		open?: boolean;
		event: Schedule;
		timezone: string;
		defaultDayKey: string;
		saving?: boolean;
		onSubmit: (input: EventInput) => void;
		onCancel: () => void;
	} = $props();
</script>

<!--
	EventForm brings its own footer buttons, so the Modal supplies only the
	surface and header. `bare` drops the form's card chrome, and `padding` is
	stripped off the body because the form already pads itself.
-->
<Modal
	bind:open
	title="Edit event"
	size="lg"
	dismissible={!saving}
	bodyClass="p-0"
	onClose={onCancel}
>
	<EventForm bare {event} {timezone} {defaultDayKey} {saving} {onSubmit} {onCancel} />
</Modal>
