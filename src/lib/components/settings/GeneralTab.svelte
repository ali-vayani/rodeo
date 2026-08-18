<script lang="ts">
	import { untrack } from 'svelte';
	import { Combobox } from '$lib/components/ui';

	const TIMEZONES = [
		{ value: 'America/New_York', label: 'Eastern Time (ET)' },
		{ value: 'America/Chicago', label: 'Central Time (CT)' },
		{ value: 'America/Denver', label: 'Mountain Time (MT)' },
		{ value: 'America/Phoenix', label: 'Mountain Time – No DST (MST)' },
		{ value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
		{ value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
		{ value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
		{ value: 'America/Puerto_Rico', label: 'Atlantic Time (AT)' },
		{ value: 'UTC', label: 'UTC' },
		{ value: 'Europe/London', label: 'Greenwich Mean Time (GMT)' },
		{ value: 'Europe/Paris', label: 'Central European Time (CET)' },
		{ value: 'Europe/Berlin', label: 'Central European Time (CET)' },
		{ value: 'Asia/Kolkata', label: 'India Standard Time (IST)' },
		{ value: 'Asia/Tokyo', label: 'Japan Standard Time (JST)' },
		{ value: 'Australia/Sydney', label: 'Australian Eastern Time (AET)' }
	];

	let {
		timezone,
		saving,
		onSave
	}: {
		timezone: string;
		saving: boolean;
		onSave: (updates: { timezone: string }) => void;
	} = $props();

	let localTimezone = $state(untrack(() => timezone));
</script>

<div class="max-w-[560px]">
	<div class="mb-5">
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Timezone
		</div>
		<div class="mb-2 text-xs text-muted-foreground">
			Used to display and interpret all dates and schedule times across the platform.
		</div>
		<!--
			An IANA identifier the organizer already knows the name of, in a list long
			enough that scrolling it was the slow part. A stored value outside the list
			is appended so it stays selectable rather than silently vanishing.
		-->
		<Combobox
			bind:value={localTimezone}
			options={[
				...TIMEZONES.map((tz) => ({ value: tz.value, label: `${tz.label} — ${tz.value}` })),
				...(TIMEZONES.find((t) => t.value === localTimezone)
					? []
					: [{ value: localTimezone, label: localTimezone }])
			]}
			ariaLabel="Timezone"
			placeholder="Search timezones…"
		/>
	</div>

	<button
		onclick={() => onSave({ timezone: localTimezone })}
		disabled={saving}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Changes'}
	</button>
</div>
