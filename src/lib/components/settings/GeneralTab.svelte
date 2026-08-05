<script lang="ts">
	import { untrack } from 'svelte';

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
		<select
			bind:value={localTimezone}
			class="w-full cursor-pointer rounded border border-border bg-white px-3 py-[7px] text-[13px] text-primary outline-none"
		>
			{#each TIMEZONES as tz (tz)}
				<option value={tz.value}>{tz.label} — {tz.value}</option>
			{/each}
			{#if !TIMEZONES.find((t) => t.value === localTimezone)}
				<option value={localTimezone}>{localTimezone}</option>
			{/if}
		</select>
	</div>

	<button
		onclick={() => onSave({ timezone: localTimezone })}
		disabled={saving}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Changes'}
	</button>
</div>
