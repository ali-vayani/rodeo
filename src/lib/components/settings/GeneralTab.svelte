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
		<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
			Timezone
		</div>
		<div class="text-xs text-muted-foreground mb-2">
			Used to display and interpret all dates and schedule times across the platform.
		</div>
		<select
			bind:value={localTimezone}
			class="w-full text-[13px] text-primary bg-white border border-border rounded px-3 py-[7px] outline-none cursor-pointer"
		>
			{#each TIMEZONES as tz}
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
		class="text-[13px] font-semibold text-white bg-primary border-none rounded-md py-[9px] px-[18px] cursor-pointer disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Changes'}
	</button>
</div>
