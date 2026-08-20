<script lang="ts">
	import { tick } from 'svelte';
	import { Badge, Button, EmptyState, Modal, Spinner, controlClass } from '$lib/components/ui';
	import { humanizeEnum, initials } from '$lib/format';
	import { decisionTone, statusTone } from '$lib/ui/tone';
	import { errorMessage } from '$lib/ui/errors';
	import { cn } from '$lib/utils';
	import type { Role, UserStatus } from '$lib/generated/prisma/enums';
	import {
		clampPosition,
		decisionOptions,
		filterAccounts,
		indexAccounts,
		loadFilters,
		loadPosition,
		POSITION_KEY,
		saveFilters,
		savePosition,
		sortAccounts,
		type DecisionFilterValue,
		type DevAccount,
		type IndexedAccount,
		type Position
	} from './switcher';

	/**
	 * DEV ONLY. Floating account switcher.
	 *
	 * Mounted from the root layout behind `{#if dev}` and a dynamic import, so neither
	 * this component nor its chunk exists in a production build. See
	 * `src/routes/dev/accounts/+server.ts` for the endpoint and the gate.
	 *
	 * It sits in `src/lib/dev/` rather than `components/ui|patterns/` because
	 * `scripts/lint-tokens.mjs` scopes those directories and a draggable widget needs
	 * runtime `left`/`top`/`z-index` numbers no token can express.
	 */

	const BUTTON_SIZE = 36;
	const MARGIN = 12;
	/** Below this, the pointer gesture was a press rather than a drag. */
	const DRAG_THRESHOLD = 4;
	/** A localhost fetch is ~10ms; an instant spinner reads as a flicker, not feedback. */
	const SPINNER_DELAY_MS = 150;

	let open = $state(false);
	let accounts = $state<IndexedAccount[]>([]);
	let currentUid = $state<string | null>(null);
	let loading = $state(false);
	/**
	 * Whether a fetch has ever completed. Without it the header claims "Not signed in"
	 * for the ~100ms before the first response lands.
	 */
	let loaded = $state(false);
	let showSpinner = $state(false);
	let panelError = $state<string | null>(null);
	let switching = $state(false);

	/**
	 * Restored at init rather than in an `$effect`. The root layout imports this component
	 * dynamically behind `{#if dev}`, so it never runs during SSR and `localStorage`
	 * always exists here.
	 */
	const restored = loadFilters(localStorage);

	let query = $state(restored.query);
	let roleFilter = $state<Role[]>(restored.roles as Role[]);
	let statusFilter = $state<UserStatus[]>(restored.statuses as UserStatus[]);
	/** Released — the decision the applicant sees. */
	let decisionFilter = $state<DecisionFilterValue[]>(restored.decisions as DecisionFilterValue[]);
	/** Held — decided by a reviewer, not yet released. */
	let pendingFilter = $state<DecisionFilterValue[]>(
		restored.pendingDecisions as DecisionFilterValue[]
	);

	// Written back on every change, so the full-page navigation a switch performs
	// doesn't discard the narrowing you just did to find that account.
	$effect(() => {
		saveFilters(localStorage, {
			query,
			roles: roleFilter,
			statuses: statusFilter,
			decisions: decisionFilter,
			pendingDecisions: pendingFilter
		});
	});

	let searchEl = $state<HTMLInputElement | null>(null);
	let buttonEl: HTMLButtonElement | null = null;

	// -- Position ---------------------------------------------------------------
	// `null` means "not yet dragged": the button renders with right/bottom so it stays
	// glued to its corner across resizes. The first drag converts it to left/top.
	let pos = $state<Position | null>(null);

	// Deliberately NOT $state. Written on every pointermove and read only by the rAF that
	// repaints, the same reasoning as `lastActivityAt` in reviewSession.svelte.ts. Routing
	// a ~120Hz pointer stream through the reactive graph would render per sample. The one
	// reactive write happens on pointerup.
	let dragging = false;
	let moved = false;
	let grabX = 0;
	let grabY = 0;
	let originX = 0;
	let originY = 0;
	let liveX = 0;
	let liveY = 0;
	let frame = 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
	const buttonSize = () => ({ w: BUTTON_SIZE, h: BUTTON_SIZE });

	function clamped(next: Position): Position {
		return clampPosition(next, viewport(), buttonSize(), MARGIN);
	}

	/**
	 * Restore the stored position, clamped — a corner on a 4K monitor is off-screen on
	 * a laptop, and the widget has to come back somewhere clickable.
	 */
	$effect(() => {
		const stored = loadPosition(localStorage);
		if (stored) pos = clamped(stored);
	});

	function persist() {
		// A window drag fires resize at frame rate; the clamp is trivial but a
		// localStorage write per frame is not.
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (pos) savePosition(localStorage, pos);
		}, 200);
	}

	function onResize() {
		if (!pos) return; // still corner-pinned — CSS is already handling it
		pos = clamped(pos);
		persist();
	}

	function paint() {
		frame = 0;
		if (!buttonEl) return;
		const next = clamped({ x: liveX, y: liveY });
		buttonEl.style.left = `${next.x}px`;
		buttonEl.style.top = `${next.y}px`;
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0 || !buttonEl) return;
		const rect = buttonEl.getBoundingClientRect();

		// Switch from the corner-pinned default to explicit coordinates before the
		// first move, so right/bottom and left/top never both apply.
		pos = { x: rect.left, y: rect.top };

		grabX = event.clientX - rect.left;
		grabY = event.clientY - rect.top;
		originX = event.clientX;
		originY = event.clientY;
		liveX = rect.left;
		liveY = rect.top;
		dragging = true;
		moved = false;
		buttonEl.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		liveX = event.clientX - grabX;
		liveY = event.clientY - grabY;

		if (!moved && Math.hypot(event.clientX - originX, event.clientY - originY) > DRAG_THRESHOLD) {
			moved = true;
		}
		if (moved && !frame) frame = requestAnimationFrame(paint);
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		buttonEl?.releasePointerCapture(event.pointerId);
		if (!moved) return; // a press — onClick opens the panel

		if (frame) {
			cancelAnimationFrame(frame);
			frame = 0;
		}
		pos = clamped({ x: liveX, y: liveY });
		persist();
	}

	function onClick() {
		// Checked here rather than in pointerup because a drag ends with a click too. It is
		// also what keeps keyboard activation working: Enter and Space produce a click with
		// no pointer events before it, so `moved` is false and the panel opens.
		if (moved) {
			moved = false;
			return;
		}
		if (open) open = false;
		else void openPanel();
	}

	function resetPosition() {
		pos = null;
		clearTimeout(saveTimer);
		try {
			localStorage.removeItem(POSITION_KEY);
		} catch {
			// Private mode. The button is back in its corner either way.
		}
		if (buttonEl) {
			buttonEl.style.left = '';
			buttonEl.style.top = '';
		}
	}

	// ── Data ────────────────────────────────────────────────────────────────────

	async function fetchAccounts() {
		loading = true;
		panelError = null;
		const spinnerTimer = setTimeout(() => (showSpinner = true), SPINNER_DELAY_MS);

		try {
			const res = await fetch('/dev/accounts');
			if (!res.ok) throw new Error(`Could not load accounts (${res.status}).`);
			const data: { accounts: DevAccount[]; currentUid: string | null } = await res.json();
			accounts = sortAccounts(indexAccounts(data.accounts));
			currentUid = data.currentUid;
			loaded = true;
		} catch (error) {
			panelError = errorMessage(error, 'Could not load accounts.');
		} finally {
			clearTimeout(spinnerTimer);
			showSpinner = false;
			loading = false;
		}
	}

	async function openPanel() {
		open = true;
		// Fetched on first open rather than on mount, since this component is on every page
		// and most loads never open it. A switch is a full navigation.
		if (!accounts.length && !loading) void fetchAccounts();
		await tick();
		searchEl?.focus();
		// select(), so opening again replaces the last query instead of appending.
		searchEl?.select();
	}

	async function switchTo(uid: string | null) {
		if (switching) return;
		switching = true;
		panelError = null;

		try {
			const res = await fetch('/dev/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uid })
			});
			if (!res.ok) throw new Error(`Switch failed (${res.status}).`);
			const { redirectTo }: { redirectTo: string } = await res.json();

			// A real document navigation rather than invalidateAll(). Becoming someone else
			// invalidates every piece of client state in the app, and there is no reliable way
			// to enumerate it. A full load is the only clean slate.
			location.assign(redirectTo);
		} catch (error) {
			switching = false;
			panelError = errorMessage(error, 'Could not switch account.');
		}
	}

	// ── Filtering ───────────────────────────────────────────────────────────────

	// Only offer chips that can match something, which drops the roles and statuses this
	// seed never created. `accounts` is already in role-rank order and a Set keeps
	// first-seen order, so the chips come out ranked without a sort.
	const roleOptions = $derived([...new Set(accounts.map((a) => a.role))]);
	const statusOptions = $derived([...new Set(accounts.map((a) => a.status))].sort());
	const activeDecisionOptions = $derived(decisionOptions(accounts, 'activeDecision'));
	const pendingDecisionOptions = $derived(decisionOptions(accounts, 'pendingDecision'));

	const filtered = $derived(
		filterAccounts(accounts, {
			query,
			roles: roleFilter,
			statuses: statusFilter,
			decisions: decisionFilter,
			pendingDecisions: pendingFilter
		})
	);
	const hasFilters = $derived(
		query.trim().length > 0 ||
			roleFilter.length > 0 ||
			statusFilter.length > 0 ||
			decisionFilter.length > 0 ||
			pendingFilter.length > 0
	);
	const currentAccount = $derived(accounts.find((a) => a.uid === currentUid) ?? null);

	function toggle<T>(list: T[], value: T): T[] {
		return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
	}

	function clearFilters() {
		query = '';
		roleFilter = [];
		statusFilter = [];
		decisionFilter = [];
		pendingFilter = [];
		searchEl?.focus();
	}

	/**
	 * The role header to emit before this row, or null to continue the current group.
	 * Comparing against the previously *rendered* row means search and filtering need
	 * no separate code path — a group filtered down to nothing simply never appears.
	 */
	function groupHeader(rows: IndexedAccount[], index: number): Role | null {
		const role = rows[index].role;
		if (index === 0) return role;
		return rows[index - 1].role === role ? null : role;
	}

	function groupCount(rows: IndexedAccount[], role: Role): number {
		return rows.filter((r) => r.role === role).length;
	}

	function onKeydown(event: KeyboardEvent) {
		// Cmd/Ctrl+K. preventDefault stops the browser's own address-bar search; the
		// app itself binds no global shortcuts, so nothing in-page is clobbered.
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			if (open) open = false;
			else void openPanel();
		}
		// Escape is Modal's own (bits-ui Dialog), so it is not handled here.
	}
</script>

<svelte:window onkeydown={onKeydown} onresize={onResize} />

<!--
	One labelled row of toggle chips for one column.

	A snippet rather than four copies, because the only thing that differed between the
	role and status rows was the array. `string` rather than a generic: every value here
	is a string enum, and the call sites do the one cast.
-->
{#snippet chipRow(
	label: string,
	hint: string,
	options: readonly string[],
	selected: readonly string[],
	onToggle: (value: string) => void
)}
	{#if options.length}
		<div
			class="mt-2 grid grid-cols-[4.25rem_1fr] items-start gap-x-2"
			role="group"
			aria-label={label}
		>
			<!--
							`title` rather than visible help text: the panel is already dense, and the
							label alone answers the question this row exists to answer.
						-->
			<span
				title={hint}
				class="cursor-help pt-1 font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase"
			>
				{label}
			</span>
			<div class="flex flex-wrap items-center gap-1.5">
				{#each options as option (option)}
					<button
						type="button"
						onclick={() => onToggle(option)}
						aria-pressed={selected.includes(option)}
						class={cn(
							'cursor-pointer rounded-sm border px-1.5 py-0.5 font-mono text-2xs',
							'tracking-eyebrow uppercase transition-colors duration-150',
							'focus-visible:shadow-ring',
							selected.includes(option)
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-card text-foreground-secondary hover:bg-muted'
						)}
					>
						{humanizeEnum(option)}
					</button>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

<!--
	Fixed rather than absolute, so it stays put while a long table scrolls under it.
	z-index 300 puts it above ToastHost (200), whose container is pointer-events-none, so
	sitting below toasts would make the button dead for 3.2s after every success. Hidden
	while the panel is open, because Modal portals at z-50.
-->
<button
	bind:this={buttonEl}
	type="button"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onclick={onClick}
	aria-label="Dev account switcher (Cmd+K)"
	aria-haspopup="dialog"
	aria-expanded={open}
	title="Switch account — ⌘K. Drag to move."
	class={cn(
		'flex cursor-grab items-center justify-center rounded-full border border-border-strong',
		'bg-primary font-mono text-sm text-primary-foreground shadow-md select-none',
		'transition-opacity duration-150 hover:opacity-90 focus-visible:shadow-ring',
		'active:cursor-grabbing',
		open && 'pointer-events-none opacity-0'
	)}
	style="position:fixed; z-index:300; touch-action:none; width:{BUTTON_SIZE}px; height:{BUTTON_SIZE}px; {pos
		? `left:${pos.x}px; top:${pos.y}px;`
		: `right:${MARGIN * 2}px; bottom:${MARGIN * 2}px;`}"
>
	⇄
</button>

<Modal
	bind:open
	size="lg"
	title="Switch account"
	description={!loaded
		? 'Loading accounts…'
		: currentAccount
			? `Signed in as ${currentAccount.name} · ${currentAccount.email}`
			: 'Not signed in'}
	bodyClass="pt-0"
>
	<!--
			Sticky rather than outside the scroll container: Modal's body owns the
			`panel-scroll` cap, and reaching around it would override a utility the primitive
			is entitled to change.
		-->
	<div class="sticky top-0 z-10 -mx-6 bg-card px-6 pt-5 pb-3">
		<input
			bind:this={searchEl}
			bind:value={query}
			type="search"
			placeholder="Search name, email or role…"
			aria-label="Search accounts"
			class={controlClass({ class: 'w-full' })}
		/>

		<!--
					Every group is labelled with the column it filters, rather than four unlabelled
					chip rows. "Decision" and "Pending" are named exactly as /admin/users titles the
					same two columns, so the vocabulary is one thing to learn.
				-->
		{@render chipRow('Role', 'Matches any role the account holds', roleOptions, roleFilter, (v) => {
			roleFilter = toggle(roleFilter, v as Role);
		})}

		{@render chipRow(
			'Status',
			'Where the account sits in the funnel — created, applied, confirmed, checked in',
			statusOptions,
			statusFilter,
			(v) => {
				statusFilter = toggle(statusFilter, v as UserStatus);
			}
		)}

		{@render chipRow(
			'Decision',
			'The released decision — what the applicant actually sees (activeDecision)',
			activeDecisionOptions,
			decisionFilter,
			(v) => {
				decisionFilter = toggle(decisionFilter, v as DecisionFilterValue);
			}
		)}

		{@render chipRow(
			'Pending',
			'Decided by a reviewer but not yet released to the applicant (pendingDecision)',
			pendingDecisionOptions,
			pendingFilter,
			(v) => {
				pendingFilter = toggle(pendingFilter, v as DecisionFilterValue);
			}
		)}

		<div class="mt-2.5 flex items-center justify-between">
			<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
				{filtered.length} of {accounts.length}
			</span>
			{#if hasFilters}
				<button
					type="button"
					onclick={clearFilters}
					class="cursor-pointer border-none bg-transparent p-0 text-xs text-foreground-secondary
					       underline transition-colors duration-150 hover:text-foreground
					       focus-visible:shadow-ring"
				>
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if panelError}
		<EmptyState compact title="Error" message={panelError}>
			{#snippet action()}
				<Button variant="secondary" onclick={() => void fetchAccounts()}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else if showSpinner}
		<div class="flex justify-center py-10"><Spinner /></div>
	{:else if !loading && filtered.length === 0}
		<EmptyState
			compact
			message={accounts.length
				? 'No accounts match those filters.'
				: 'No seeded accounts found. Run npm run db:seed.'}
		>
			{#snippet action()}
				{#if hasFilters}
					<Button variant="secondary" onclick={clearFilters}>Clear filters</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<ul class={cn('m-0 list-none p-0', switching && 'pointer-events-none opacity-60')}>
			{#each filtered as account, index (account.uid)}
				{@const header = groupHeader(filtered, index)}
				{#if header}
					<!--
											Static rather than sticky: the search block above already owns `top-0`, so a
											sticky header would slide underneath it and vanish.
										-->
					<li
						class="flex items-center gap-2 bg-card pt-3 pb-1 font-mono text-2xs
						       tracking-eyebrow text-foreground-tertiary uppercase"
					>
						{humanizeEnum(header)}
						<span class="text-faint">·{groupCount(filtered, header)}</span>
						<span class="h-px flex-1 bg-border"></span>
					</li>
				{/if}

				<li>
					<button
						type="button"
						onclick={() => void switchTo(account.uid)}
						disabled={switching}
						aria-current={account.uid === currentUid ? 'true' : undefined}
						class={cn(
							'flex w-full cursor-pointer items-center gap-2.5 rounded-md border-l-2 px-2 py-1.5',
							'text-left transition-colors duration-150 focus-visible:shadow-ring',
							account.uid === currentUid
								? 'border-l-primary bg-muted'
								: 'border-l-transparent bg-transparent hover:bg-neutral-25'
						)}
					>
						<span
							class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted
							       font-mono text-2xs text-foreground-secondary"
							aria-hidden="true"
						>
							{initials(account.name)}
						</span>

						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-base text-foreground">{account.name}</span>
							<span class="truncate font-mono text-2xs text-foreground-tertiary">
								{account.email}
							</span>
						</span>

						<span class="flex shrink-0 flex-wrap items-center justify-end gap-1">
							<!-- Outline, not a colored tone: tone.ts reserves color for status, and a privilege
														     rainbow would read as an alert. Role is separated from state by weight. -->
							<Badge variant="outline">{humanizeEnum(account.role)}</Badge>

							<Badge tone={statusTone(account.status)} dot>{humanizeEnum(account.status)}</Badge>

							{#if account.activeDecision}
								<Badge tone={decisionTone(account.activeDecision)}>
									{humanizeEnum(account.activeDecision)}
								</Badge>
							{:else if account.pendingDecision === 'PENDING'}
								<!-- In the queue, undecided. Distinct from the branch below: PENDING is
								     the absence of a decision, not one being withheld. -->
								<Badge>In review</Badge>
							{:else if account.pendingDecision}
								<!-- Decided but not released. Outline and labelled so it can never be
								     read as the decision the applicant would actually see. -->
								<span title="Decided but not yet released to the applicant">
									<Badge variant="outline">Held: {humanizeEnum(account.pendingDecision)}</Badge>
								</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#snippet footer()}
		<button
			type="button"
			onclick={resetPosition}
			class="mr-auto cursor-pointer border-none bg-transparent p-0 text-xs text-foreground-secondary
			       underline transition-colors duration-150 hover:text-foreground focus-visible:shadow-ring"
		>
			Reset button position
		</button>
		{#if currentUid}
			<Button variant="secondary" onclick={() => void switchTo(null)} disabled={switching}>
				Sign out
			</Button>
		{/if}
	{/snippet}
</Modal>
