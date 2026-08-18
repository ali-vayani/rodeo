<script lang="ts">
	import { untrack } from 'svelte';
	import { Combobox } from '$lib/components/ui';
	import { US_STATES } from '$lib/data/states';

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

	const STATES = Object.entries(US_STATES).map(([value, label]) => ({ value, label }));

	let {
		timezone,
		homeState,
		saving,
		onSave
	}: {
		timezone: string;
		/** US postal code, or null for an event that hasn't said. */
		homeState: string | null;
		saving: boolean;
		onSave: (updates: { timezone: string; homeState: string | null }) => void;
	} = $props();

	let localTimezone = $state(untrack(() => timezone));
	// '' is the Combobox's own "cleared", which maps back to NULL on save — the column
	// is nullable and an empty string there would be a state code of zero length.
	let localHomeState = $state(untrack(() => homeState ?? ''));
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

	<div class="mb-5">
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Home State
		</div>
		<div class="mb-2 text-xs text-muted-foreground">
			The state the event is held in. The applicant filters use it to offer
			<em>in-state</em> and <em>out-of-state</em> as one click each, worked out from each applicant's
			university — nothing is added to the application form. Leave it unset and there is no State filter
			at all, since without a home state there is no "outside" either.
		</div>
		<Combobox
			bind:value={localHomeState}
			options={STATES}
			ariaLabel="Home state"
			placeholder="No home state"
			emptyMessage="No matching state"
			clearable
		/>
	</div>

	<button
		onclick={() => onSave({ timezone: localTimezone, homeState: localHomeState || null })}
		disabled={saving}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Changes'}
	</button>
</div>
