<script lang="ts">
	import { untrack } from 'svelte';
	import { toDatetimeLocal } from '$lib/utils';
	import { formatDateTime } from '$lib/format';

	const roleConfigs = [
		{ key: 'hacker', label: 'Hacker' },
		{ key: 'mentor', label: 'Mentor' },
		{ key: 'judge', label: 'Judge' },
		{ key: 'volunteer', label: 'Volunteer' }
	] as const;

	type RoleKey = (typeof roleConfigs)[number]['key'];

	type RoleDateUpdates = {
		[K in RoleKey as `${K}ApplicationOpen`]: Date | null;
	} & {
		[K in RoleKey as `${K}ApplicationDeadline`]: Date | null;
	};

	let {
		applicationOpen,
		applicationDeadline,
		admissionsSend,
		RSVPDeadline,
		hackathonStartDate,
		hackerApplicationOpen = null,
		hackerApplicationDeadline = null,
		mentorApplicationOpen = null,
		mentorApplicationDeadline = null,
		judgeApplicationOpen = null,
		judgeApplicationDeadline = null,
		volunteerApplicationOpen = null,
		volunteerApplicationDeadline = null,
		saving,
		onSave
	}: {
		applicationOpen: Date;
		applicationDeadline: Date;
		admissionsSend: Date | null;
		RSVPDeadline: Date | null;
		hackathonStartDate: Date;
		hackerApplicationOpen?: Date | null;
		hackerApplicationDeadline?: Date | null;
		mentorApplicationOpen?: Date | null;
		mentorApplicationDeadline?: Date | null;
		judgeApplicationOpen?: Date | null;
		judgeApplicationDeadline?: Date | null;
		volunteerApplicationOpen?: Date | null;
		volunteerApplicationDeadline?: Date | null;
		saving: boolean;
		onSave: (
			updates: {
				applicationOpen: Date;
				applicationDeadline: Date;
				admissionsSend: Date | null;
				RSVPDeadline: Date | null;
				hackathonStartDate: Date;
			} & RoleDateUpdates
		) => void;
	} = $props();

	// ── Global dates ───────────────────────────────────────────────────────────
	let appOpen = $state(untrack(() => toDatetimeLocal(applicationOpen)));
	let appClose = $state(untrack(() => toDatetimeLocal(applicationDeadline)));
	let decisionRelease = $state(untrack(() => toDatetimeLocal(admissionsSend)));
	let rsvpDeadline = $state(untrack(() => toDatetimeLocal(RSVPDeadline)));
	let eventStart = $state(untrack(() => toDatetimeLocal(hackathonStartDate)));

	type GlobalField = 'appOpen' | 'appClose' | 'decisionRelease' | 'rsvpDeadline' | 'eventStart';

	/**
	 * Which controls hold a half-typed value — a date with no time, usually.
	 *
	 * A `datetime-local` reports anything it cannot parse as `''`, so by value alone an
	 * incomplete entry is indistinguishable from a deliberately cleared one. That
	 * mattered enough to be a bug twice over: the required fields turned `''` into
	 * `new Date('')`, and superjson serialises a Date by calling `toISOString()`, which
	 * throws `RangeError: Invalid time value` before the request is even sent — so the
	 * toast read "Invalid time value" and named no field. The optional fields had the
	 * quieter version of the same fault, saving a half-typed deadline as "no deadline".
	 *
	 * `validity.badInput` is the only thing that separates the two cases, and it is
	 * readable only from the element, so it is mirrored here on every input event.
	 */
	let incomplete = $state<Record<GlobalField, boolean>>({
		appOpen: false,
		appClose: false,
		decisionRelease: false,
		rsvpDeadline: false,
		eventStart: false
	});

	function track(field: GlobalField) {
		return (event: Event & { currentTarget: HTMLInputElement }) => {
			incomplete[field] = event.currentTarget.validity.badInput;
		};
	}

	// ── Per-role dates ─────────────────────────────────────────────────────────

	function initRoleOpen(key: RoleKey): string {
		const map = {
			hacker: hackerApplicationOpen,
			mentor: mentorApplicationOpen,
			judge: judgeApplicationOpen,
			volunteer: volunteerApplicationOpen
		} as const;
		return toDatetimeLocal(map[key]);
	}

	function initRoleClose(key: RoleKey): string {
		const map = {
			hacker: hackerApplicationDeadline,
			mentor: mentorApplicationDeadline,
			judge: judgeApplicationDeadline,
			volunteer: volunteerApplicationDeadline
		} as const;
		return toDatetimeLocal(map[key]);
	}

	let roleOpen = $state<Record<RoleKey, string>>(
		untrack(
			() =>
				Object.fromEntries(roleConfigs.map(({ key }) => [key, initRoleOpen(key)])) as Record<
					RoleKey,
					string
				>
		)
	);

	let roleClose = $state<Record<RoleKey, string>>(
		untrack(
			() =>
				Object.fromEntries(roleConfigs.map(({ key }) => [key, initRoleClose(key)])) as Record<
					RoleKey,
					string
				>
		)
	);

	let roleOpenIncomplete = $state<Record<RoleKey, boolean>>(
		untrack(
			() =>
				Object.fromEntries(roleConfigs.map(({ key }) => [key, false])) as Record<RoleKey, boolean>
		)
	);

	let roleCloseIncomplete = $state<Record<RoleKey, boolean>>(
		untrack(
			() =>
				Object.fromEntries(roleConfigs.map(({ key }) => [key, false])) as Record<RoleKey, boolean>
		)
	);

	function trackRole(key: RoleKey, field: 'open' | 'close') {
		return (event: Event & { currentTarget: HTMLInputElement }) => {
			if (field === 'open') roleOpenIncomplete[key] = event.currentTarget.validity.badInput;
			else roleCloseIncomplete[key] = event.currentTarget.validity.badInput;
		};
	}

	function clearRole(key: RoleKey) {
		roleOpen[key] = '';
		roleClose[key] = '';
		roleOpenIncomplete[key] = false;
		roleCloseIncomplete[key] = false;
	}

	// ── Error derivation ───────────────────────────────────────────────────────

	const INCOMPLETE = 'Enter a date and a time — both are needed.';
	const REQUIRED = 'Required. Pick a date and time.';

	/** The offending value, so the message says what it is being compared against. */
	function at(value: string): string {
		return ` (${formatDateTime(value)})`;
	}

	/**
	 * One message per control, most specific first: a half-typed value outranks a
	 * missing one, and both outrank an ordering complaint, which would otherwise be
	 * reported against a field the reader has not finished filling in.
	 */
	let errors = $derived({
		appOpen: incomplete.appOpen
			? INCOMPLETE
			: !appOpen
				? REQUIRED
				: appClose && appOpen >= appClose
					? `Must be before Applications Close${at(appClose)}.`
					: null,

		appClose: incomplete.appClose ? INCOMPLETE : !appClose ? REQUIRED : null,

		decisionRelease: incomplete.decisionRelease
			? INCOMPLETE
			: !decisionRelease
				? null
				: appClose && decisionRelease <= appClose
					? `Must be after Applications Close${at(appClose)}.`
					: rsvpDeadline && decisionRelease >= rsvpDeadline
						? `Must be before the RSVP Deadline${at(rsvpDeadline)}.`
						: null,

		rsvpDeadline: incomplete.rsvpDeadline
			? INCOMPLETE
			: !rsvpDeadline
				? null
				: appClose && rsvpDeadline <= appClose
					? `Must be after Applications Close${at(appClose)}.`
					: null,

		eventStart: incomplete.eventStart
			? INCOMPLETE
			: !eventStart
				? REQUIRED
				: rsvpDeadline && eventStart <= rsvpDeadline
					? `Must be after the RSVP Deadline${at(rsvpDeadline)}.`
					: null
	});

	let roleErrors = $derived(
		Object.fromEntries(
			roleConfigs.map(({ key }) => [
				key,
				{
					open: roleOpenIncomplete[key] ? INCOMPLETE : null,
					close: roleCloseIncomplete[key]
						? INCOMPLETE
						: roleOpen[key] && roleClose[key] && roleOpen[key] >= roleClose[key]
							? `Must be after Opens${at(roleOpen[key])}.`
							: null
				}
			])
		) as Record<RoleKey, { open: string | null; close: string | null }>
	);

	let hasErrors = $derived(
		Object.values(errors).some(Boolean) || Object.values(roleErrors).some((e) => e.open || e.close)
	);

	function handleSave() {
		if (hasErrors) return;

		const roleUpdates = Object.fromEntries(
			roleConfigs.flatMap(({ key }) => {
				const open = roleOpen[key] ? new Date(roleOpen[key]) : null;
				const close = roleClose[key] ? new Date(roleClose[key]) : null;
				return [
					[`${key}ApplicationOpen`, open],
					[`${key}ApplicationDeadline`, close]
				];
			})
		) as RoleDateUpdates;

		const updates = {
			applicationOpen: new Date(appOpen),
			applicationDeadline: new Date(appClose),
			admissionsSend: decisionRelease ? new Date(decisionRelease) : null,
			RSVPDeadline: rsvpDeadline ? new Date(rsvpDeadline) : null,
			hackathonStartDate: new Date(eventStart),
			...roleUpdates
		};

		// Belt and braces for the `RangeError` above: `badInput` is the browser's answer
		// and this is ours, so a value that parses to nothing cannot reach the wire even
		// if a control ever reports itself clean.
		const unparseable = [
			updates.applicationOpen,
			updates.applicationDeadline,
			updates.hackathonStartDate,
			...Object.values(roleUpdates)
		].some((d) => d != null && Number.isNaN(d.getTime()));
		if (unparseable) return;

		onSave(updates);
	}
</script>

<div class="max-w-[560px]">
	<div class="mb-5 space-y-4">
		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Applications Open
			</div>
			<input
				type="datetime-local"
				bind:value={appOpen}
				oninput={track('appOpen')}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.appOpen
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.appOpen}
				<div class="mt-1 text-xs text-destructive">{errors.appOpen}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Applications Close
			</div>
			<input
				type="datetime-local"
				bind:value={appClose}
				oninput={track('appClose')}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.appClose
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.appClose}
				<div class="mt-1 text-xs text-destructive">{errors.appClose}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Decision Release
				<span class="font-normal tracking-normal text-muted-foreground normal-case">
					— optional</span
				>
			</div>
			<div class="mb-1.5 text-xs text-muted-foreground">
				Must fall after Applications Close and before RSVP Deadline.
			</div>
			<input
				type="datetime-local"
				bind:value={decisionRelease}
				oninput={track('decisionRelease')}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.decisionRelease
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.decisionRelease}
				<div class="mt-1 text-xs text-destructive">{errors.decisionRelease}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				RSVP Deadline
				<span class="font-normal tracking-normal text-muted-foreground normal-case">
					— optional</span
				>
			</div>
			<div class="mb-1.5 text-xs text-muted-foreground">
				Leave blank to keep RSVPs open; wallet passes then unlock at Event Start.
			</div>
			<input
				type="datetime-local"
				bind:value={rsvpDeadline}
				oninput={track('rsvpDeadline')}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.rsvpDeadline
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.rsvpDeadline}
				<div class="mt-1 text-xs text-destructive">{errors.rsvpDeadline}</div>
			{/if}
		</div>

		<div>
			<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Event Start
			</div>
			<input
				type="datetime-local"
				bind:value={eventStart}
				oninput={track('eventStart')}
				class="w-full rounded border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none {errors.eventStart
					? 'border-destructive'
					: 'border-border'}"
			/>
			{#if errors.eventStart}
				<div class="mt-1 text-xs text-destructive">{errors.eventStart}</div>
			{/if}
		</div>
	</div>

	<!-- Per-role deadline overrides -->
	<div class="mb-5 rounded-md border border-border bg-muted/40 p-4">
		<div class="mb-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Per-Role Deadlines
			<span class="font-normal tracking-normal text-muted-foreground normal-case">— optional</span>
		</div>
		<p class="mb-4 text-xs text-muted-foreground">
			Override the global window for individual roles. Leave a row blank to use the global dates.
			Either field can be set independently.
		</p>

		<div class="space-y-4">
			{#each roleConfigs as { key, label } (key)}
				<div>
					<div class="mb-2 flex items-center justify-between">
						<span class="text-xs font-semibold text-foreground">{label}</span>
						{#if roleOpen[key] || roleClose[key]}
							<button
								type="button"
								onclick={() => clearRole(key)}
								class="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
							>
								Clear
							</button>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<div
								class="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
							>
								Opens
							</div>
							<input
								type="datetime-local"
								bind:value={roleOpen[key]}
								oninput={trackRole(key, 'open')}
								class="w-full rounded border bg-white px-2.5 py-[6px] font-mono text-[12px] text-primary outline-none {roleErrors[
									key
								].open
									? 'border-destructive'
									: 'border-border'}"
							/>
							{#if roleErrors[key].open}
								<div class="mt-1 text-xs text-destructive">{roleErrors[key].open}</div>
							{/if}
						</div>
						<div>
							<div
								class="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
							>
								Closes
							</div>
							<input
								type="datetime-local"
								bind:value={roleClose[key]}
								oninput={trackRole(key, 'close')}
								class="w-full rounded border bg-white px-2.5 py-[6px] font-mono text-[12px] text-primary outline-none {roleErrors[
									key
								].close
									? 'border-destructive'
									: 'border-border'}"
							/>
							{#if roleErrors[key].close}
								<div class="mt-1 text-xs text-destructive">{roleErrors[key].close}</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<button
		onclick={handleSave}
		disabled={saving || hasErrors}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Dates'}
	</button>
</div>
