<script lang="ts">
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import type { FilterState } from '$lib/admin/filters';

	type Sample = { uid: string; name: string; email: string };

	let {
		mode = $bindable(),
		roleFilter = $bindable(),
		statusFilter = $bindable(),
		decisionFilter = $bindable(),
		emailText = $bindable(),
		count,
		sample,
		unknownEmails,
		loading,
		onChange,
		onShowAll
	}: {
		mode: 'filters' | 'emails';
		roleFilter: FilterState;
		statusFilter: FilterState;
		decisionFilter: FilterState;
		emailText: string;
		count: number | null;
		sample: Sample[];
		unknownEmails: string[];
		loading: boolean;
		onChange: () => void;
		onShowAll: () => void;
	} = $props();

	function toggle(group: FilterState, key: string): FilterState {
		return { ...group, [key]: !group[key] };
	}

	function clear(group: FilterState): FilterState {
		return Object.fromEntries(Object.keys(group).map((k) => [k, false]));
	}

	function setMode(next: 'filters' | 'emails') {
		if (mode === next) return;
		mode = next;
		onChange();
	}

	let hidden = $derived(count !== null ? Math.max(0, count - sample.length) : 0);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
	<div>
		<h2 class="text-lg font-semibold text-foreground">Select Recipients</h2>
		<p class="mt-0.5 text-xs text-foreground-secondary">
			Target a group by its attributes, or paste specific addresses.
		</p>
	</div>

	<!-- Mode toggle: the two are mutually exclusive so the selection is never ambiguous -->
	<div class="flex w-fit overflow-hidden rounded-md border border-border">
		{#each [{ id: 'filters', label: 'By filter' }, { id: 'emails', label: 'By email list' }] as m (m.id)}
			<button
				onclick={() => setMode(m.id as 'filters' | 'emails')}
				class="h-8 cursor-pointer border-none px-4 text-base transition-colors duration-150 focus-visible:shadow-ring {mode ===
				m.id
					? 'bg-primary font-semibold text-white'
					: 'bg-card text-foreground hover:bg-muted'}"
			>
				{m.label}
			</button>
		{/each}
	</div>

	{#if mode === 'filters'}
		<UserFilters
			class="rounded-md border border-border bg-card p-5"
			columns
			showHeading={false}
			{roleFilter}
			{statusFilter}
			{decisionFilter}
			onToggleRole={(r) => {
				roleFilter = toggle(roleFilter, r);
				onChange();
			}}
			onClearRole={() => {
				roleFilter = clear(roleFilter);
				onChange();
			}}
			onToggleStatus={(s) => {
				statusFilter = toggle(statusFilter, s);
				onChange();
			}}
			onClearStatus={() => {
				statusFilter = clear(statusFilter);
				onChange();
			}}
			onToggleDecision={(d) => {
				decisionFilter = toggle(decisionFilter, d);
				onChange();
			}}
			onClearDecision={() => {
				decisionFilter = clear(decisionFilter);
				onChange();
			}}
		/>
		<p class="-mt-3 text-xs text-foreground-secondary">
			Every box checked means no filter — the email goes to everyone. Unchecking every box in a
			group selects nobody.
		</p>
	{:else}
		<div class="flex flex-col gap-2 rounded-md border border-border bg-card p-5">
			<label
				for="recipient-emails"
				class="font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
			>
				Email addresses
			</label>
			<textarea
				id="recipient-emails"
				bind:value={emailText}
				oninput={onChange}
				rows="5"
				placeholder="ada@yopmail.com, grace@yopmail.com&#10;alan@yopmail.com"
				class="w-full resize-y rounded-md border border-border bg-card px-3 py-2 font-mono text-base text-foreground outline-none focus:border-primary"
			></textarea>
			<p class="text-xs text-foreground-secondary">
				Separate with commas, semicolons, or new lines. Addresses that don't match a user are
				flagged below and skipped.
			</p>

			{#if unknownEmails.length > 0}
				<div class="mt-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
					<div class="text-xs font-semibold text-destructive">
						{unknownEmails.length} address{unknownEmails.length === 1 ? '' : 'es'} matched no user
					</div>
					<div class="mt-1 font-mono text-xs break-all text-foreground">
						{unknownEmails.join(', ')}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Count block, per the mockup's big-numeral treatment -->
	<div class="flex items-center gap-6 rounded-md border-2 border-primary px-6 py-4">
		<div class="text-center">
			<div class="font-mono text-3xl leading-none font-bold text-foreground">
				{loading ? '…' : (count ?? '—')}
			</div>
			<div
				class="mt-1 font-mono text-2xs tracking-eyebrow whitespace-nowrap text-foreground-tertiary uppercase"
			>
				Recipients
			</div>
		</div>
		<div class="min-w-0 text-xs text-foreground-secondary">
			{#if count === 0}
				<span class="text-destructive">No users match this selection — nothing to send.</span>
			{:else if sample.length > 0}
				<div class="mb-1">For example:</div>
				<ul class="space-y-0.5">
					{#each sample as u (u.uid)}
						<li class="truncate font-mono text-xs text-foreground">{u.name} · {u.email}</li>
					{/each}
				</ul>
				{#if hidden > 0}
					<button
						onclick={onShowAll}
						class="mt-1 cursor-pointer border-none bg-transparent p-0 text-xs text-foreground underline underline-offset-2 hover:opacity-70"
					>
						and {hidden} more — see all {count}
					</button>
				{:else}
					<button
						onclick={onShowAll}
						class="mt-1 cursor-pointer border-none bg-transparent p-0 text-xs text-foreground-secondary underline underline-offset-2 hover:text-foreground"
					>
						See full list
					</button>
				{/if}
			{/if}
		</div>
	</div>
</div>
