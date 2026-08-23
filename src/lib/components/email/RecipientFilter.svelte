<script lang="ts">
	import UserFilters from '$lib/components/admin/UserFilters.svelte';
	import { Button, Checkbox } from '$lib/components/ui';
	import { parseEmailCsv, type FilterState } from '$lib/admin/filters';
	import type { Facet, FacetState } from '$lib/facets';

	type Sample = { uid: string; name: string; email: string };

	let {
		mode = $bindable(),
		roleFilter = $bindable(),
		statusFilter = $bindable(),
		decisionFilter = $bindable(),
		/** Application-answer facets. Empty means no filter — see `facetParams`. */
		selection = $bindable({}),
		facets = [],
		emailText = $bindable(),
		/** Mail addresses that match no account instead of flagging them. */
		allowExternal = $bindable(),
		count,
		sample,
		unknownEmails,
		/** Entries that aren't valid addresses at all. Never mailed, either way. */
		badEmails,
		externalEmails,
		loading,
		onChange,
		onShowAll
	}: {
		mode: 'filters' | 'emails';
		roleFilter: FilterState;
		statusFilter: FilterState;
		decisionFilter: FilterState;
		selection?: FacetState;
		facets?: Facet[];
		emailText: string;
		allowExternal: boolean;
		count: number | null;
		sample: Sample[];
		unknownEmails: string[];
		badEmails: string[];
		externalEmails: string[];
		loading: boolean;
		onChange: () => void;
		onShowAll: () => void;
	} = $props();

	function toggle(group: FilterState, key: string): FilterState {
		return { ...group, [key]: !group[key] };
	}

	// Reset to the all-ticked "no filter" default rather than untick everything: none
	// ticked is also "no filter" (see `buildRecipientParams`), and a count of everyone
	// above a panel with nothing selected reads as a contradiction.
	function clear(group: FilterState): FilterState {
		return Object.fromEntries(Object.keys(group).map((k) => [k, true]));
	}

	function setMode(next: 'filters' | 'emails') {
		if (mode === next) return;
		mode = next;
		onChange();
	}

	function setAllowExternal(next: boolean) {
		allowExternal = next;
		onChange();
	}

	// Rows the count block lists as examples: sampled users, then the external
	// addresses the toggle admitted.
	let examples = $derived([
		...sample.map((u) => ({ key: u.uid, name: u.name, email: u.email, external: false })),
		...(allowExternal
			? externalEmails.map((e) => ({ key: `ext:${e}`, name: '', email: e, external: true }))
			: [])
	]);
	let hidden = $derived(count !== null ? Math.max(0, count - examples.length) : 0);

	// --- CSV import ---
	let fileInput = $state<HTMLInputElement | null>(null);
	/** Cells of the last uploaded file that were not addresses. Replaced by the next import. */
	let csvErrors = $state<string[]>([]);
	let csvImportedNothing = $state(false);

	async function onFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset immediately so re-picking the same file after a fix still fires a change event.
		input.value = '';
		if (!file) return;

		const { emails, invalid } = parseEmailCsv(await file.text());
		csvErrors = invalid;
		csvImportedNothing = emails.length === 0;
		if (!emails.length) return;

		// Appended, not replacing, so an upload adds to whatever is already typed.
		emailText = emailText.trim() ? `${emailText.trim()}\n${emails.join('\n')}` : emails.join('\n');
		onChange();
	}

	// With the toggle off an address that matched nobody is a mistake and is skipped,
	// which is what the existing warning says. With it on the same address is a
	// recipient, so only the genuinely unparseable ones are skipped.
	let skipped = $derived(allowExternal ? badEmails : [...badEmails, ...unknownEmails]);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
	<div>
		<h2 class="text-lg font-semibold text-foreground">Select Recipients</h2>
		<p class="mt-0.5 text-xs text-foreground-secondary">
			Target a group by its attributes, or paste specific addresses.
		</p>
	</div>

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
			{facets}
			bind:selection
			onSelectionChange={onChange}
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
			Every box checked means no filter — the email goes to everyone. Each box you untick narrows
			the list, and clear resets a group. Under Application, selecting nothing means no filter; each
			value you pick narrows the list.
		</p>
	{:else}
		<div class="flex flex-col gap-2 rounded-md border border-border bg-card p-5">
			<div class="flex items-center justify-between gap-3">
				<label
					for="recipient-emails"
					class="font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
				>
					Email addresses
				</label>
				<input
					bind:this={fileInput}
					type="file"
					accept=".csv,text/csv"
					onchange={onFileSelected}
					class="hidden"
				/>
				<Button onclick={() => fileInput?.click()}>Import CSV</Button>
			</div>
			<textarea
				id="recipient-emails"
				bind:value={emailText}
				oninput={onChange}
				rows="5"
				placeholder="ada@yopmail.com, grace@yopmail.com&#10;alan@yopmail.com"
				class="w-full resize-y rounded-md border border-border bg-card px-3 py-2 font-mono text-base text-foreground outline-none focus:border-primary"
			></textarea>
			<p class="text-xs text-foreground-secondary">
				Separate with commas, semicolons, or new lines, or import a CSV of addresses.
				{#if allowExternal}
					Addresses that don't match a user are emailed anyway.
				{:else}
					Addresses that don't match a user are flagged below and skipped.
				{/if}
			</p>

			<!-- Import failures, kept apart from the warning below about addresses that
			     parsed but matched nobody. -->
			{#if csvImportedNothing || csvErrors.length > 0}
				<div class="mt-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
					<div class="text-xs font-semibold text-destructive">
						{#if csvErrors.length === 0}
							No email addresses found in that file
						{:else}
							{csvErrors.length} entr{csvErrors.length === 1 ? 'y' : 'ies'} in that file could not be
							read as an email address{csvImportedNothing ? ' — nothing was imported' : ''}
						{/if}
					</div>
					{#if csvErrors.length > 0}
						<div class="mt-1 font-mono text-xs break-all text-foreground">
							{csvErrors.join(', ')}
						</div>
					{/if}
				</div>
			{/if}

			<!-- The one control that lets this page mail outside the portal. Labelled in
			     full, off by default, and echoed again on the confirm step. -->
			<div class="mt-2 flex flex-col gap-1.5 border-t border-border-subtle pt-3">
				<Checkbox
					checked={allowExternal}
					label="Also email addresses that have no account"
					onCheckedChange={setAllowExternal}
					aria-describedby="allow-external-help"
				/>
				<p id="allow-external-help" class="text-xs text-foreground-secondary">
					For sponsors, judges, and anyone else outside the portal. Their messages are recorded in
					the send history like any other, but there is no name on file, so
					<span class="font-mono">{'{{name}}'}</span> becomes “there”.
				</p>
			</div>

			{#if allowExternal && externalEmails.length > 0}
				<div class="mt-1 rounded-md border border-info-200 bg-info-50 px-3 py-2">
					<div class="text-xs font-semibold text-info-700">
						{externalEmails.length} external address{externalEmails.length === 1 ? '' : 'es'} — no portal
						account, will be emailed
					</div>
					<div class="mt-1 font-mono text-xs break-all text-foreground">
						{externalEmails.join(', ')}
					</div>
				</div>
			{/if}

			{#if skipped.length > 0}
				<div class="mt-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
					<div class="text-xs font-semibold text-destructive">
						{skipped.length} address{skipped.length === 1 ? '' : 'es'}
						{allowExternal ? 'could not be read and will be skipped' : 'matched no user'}
					</div>
					<div class="mt-1 font-mono text-xs break-all text-foreground">
						{skipped.join(', ')}
					</div>
				</div>
			{/if}
		</div>
	{/if}

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
			{:else if examples.length > 0}
				<div class="mb-1">For example:</div>
				<ul class="space-y-0.5">
					{#each examples as u (u.key)}
						<li class="truncate font-mono text-xs text-foreground">
							{#if u.external}
								{u.email} · <span class="text-info-700">no account</span>
							{:else}
								{u.name} · {u.email}
							{/if}
						</li>
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
