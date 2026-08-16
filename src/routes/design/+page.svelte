<script lang="ts">
	import {
		Badge,
		Button,
		Card,
		Checkbox,
		Combobox,
		Divider,
		EmptyState,
		Eyebrow,
		Field,
		IconButton,
		Input,
		Modal,
		Spinner,
		Switch,
		Textarea,
		Tooltip
	} from '$lib/components/ui';
	import {
		ConfirmDialog,
		DataTable,
		FilterGroup,
		PageHeader,
		Pagination,
		StatCard,
		Tabs
	} from '$lib/components/patterns';
	import type { Column, TabItem } from '$lib/components/ui/types';
	import type { Tone } from '$lib/ui/tone';
	import { toast } from '$lib/ui/toast.svelte';
	import { formatDate } from '$lib/format';

	// ── Live state for the interactive specimens ────────────────────────────
	let text = $state('');
	let broken = $state('not-an-email');
	let notes = $state('');
	let role = $state('HACKER');
	let school = $state('');
	let filterRole = $state('');
	let agreed = $state(true);
	let notify = $state(false);
	let tab = $state('general');
	let vtab = $state('applied');
	let statuses = $state<string[]>(['APPLIED']);
	let page = $state(2);
	let modalOpen = $state(false);
	let confirmOpen = $state(false);
	let releasing = $state(false);

	const TONES: Tone[] = ['neutral', 'success', 'warning', 'danger', 'info'];

	const TABS: TabItem[] = [
		{ value: 'general', label: 'General' },
		{ value: 'dates', label: 'Dates' },
		{ value: 'scan', label: 'Scan groups' },
		{ value: 'danger', label: 'Danger zone' }
	];

	const VTABS: TabItem[] = [
		{ value: 'applied', label: 'Applied', badge: 248 },
		{ value: 'waitlisted', label: 'Waitlisted', badge: 61 },
		{ value: 'rejected', label: 'Rejected', badge: 45 },
		{ value: 'archived', label: 'Archived', disabled: true }
	];

	const ROLES = [
		{ value: 'HACKER', label: 'Hacker' },
		{ value: 'JUDGE', label: 'Judge' },
		{ value: 'MENTOR', label: 'Mentor' },
		{ value: 'VOLUNTEER', label: 'Volunteer' }
	];

	// A hand-picked slice of the real university preset, aliases included, so the
	// specimen exercises keyword matching without pulling 650 KB into the style guide.
	const SCHOOLS = [
		{ value: 'The University of Texas at Austin', keywords: ['UT Austin'] },
		{ value: 'The University of Texas at Dallas', keywords: ['UTD'] },
		{ value: 'Texas A & M University-College Station', keywords: ['Texas A&M University'] },
		{ value: 'Rice University' },
		{ value: 'University of Waterloo' },
		{ value: 'Tecnológico de Monterrey' }
	];

	const STATUS_OPTIONS = [
		{ value: 'CREATED', label: 'Created' },
		{ value: 'APPLIED', label: 'Applied' },
		{ value: 'CONFIRMED', label: 'Confirmed' },
		{ value: 'CHECKED_IN', label: 'Checked in' }
	];

	// ── Table specimen ──────────────────────────────────────────────────────
	interface Applicant {
		uid: string;
		name: string;
		email: string;
		role: string;
		status: Tone;
		statusLabel: string;
		decision: Tone;
		decisionLabel: string;
		createdAt: Date;
	}

	const APPLICANTS: Applicant[] = [
		{
			uid: '1',
			name: 'Priya Raman',
			email: 'priya.raman@utexas.edu',
			role: 'Hacker',
			status: 'info',
			statusLabel: 'Checked in',
			decision: 'success',
			decisionLabel: 'Accepted',
			createdAt: new Date('2026-09-12T12:00:00')
		},
		{
			uid: '2',
			name: 'Marcus Webb',
			email: 'mwebb@utexas.edu',
			role: 'Hacker',
			status: 'neutral',
			statusLabel: 'Applied',
			decision: 'warning',
			decisionLabel: 'Waitlisted',
			createdAt: new Date('2026-09-12T12:00:00')
		},
		{
			uid: '3',
			name: 'Dani Okonkwo',
			email: 'dani.o@rice.edu',
			role: 'Mentor',
			status: 'success',
			statusLabel: 'Confirmed',
			decision: 'success',
			decisionLabel: 'Accepted',
			createdAt: new Date('2026-09-11T12:00:00')
		},
		{
			uid: '4',
			name: 'Sam Ortega',
			email: 'sortega@utexas.edu',
			role: 'Hacker',
			status: 'neutral',
			statusLabel: 'Applied',
			decision: 'danger',
			decisionLabel: 'Rejected',
			createdAt: new Date('2026-09-10T12:00:00')
		}
	];

	const COLUMNS: Column<Applicant>[] = [
		{ key: 'name', header: 'Name', nowrap: true },
		{ key: 'email', header: 'Email' },
		{ key: 'role', header: 'Role', nowrap: true },
		{ key: 'status', header: 'Status', nowrap: true },
		{ key: 'decision', header: 'Decision', nowrap: true },
		{ key: 'createdAt', header: 'Added', nowrap: true, align: 'right' }
	];

	function fakeRelease() {
		releasing = true;
		setTimeout(() => {
			releasing = false;
			confirmOpen = false;
			toast.success('248 decisions released');
		}, 900);
	}
</script>

<svelte:head><title>Rodeo — Design System</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
	<PageHeader
		title="Design system"
		subtitle="Every primitive and pattern, rendered from the real components."
	>
		{#snippet meta()}v1{/snippet}
		{#snippet actions()}
			<Button variant="secondary" size="sm" href="/admin/dashboard">Back to app</Button>
		{/snippet}
	</PageHeader>

	<p class="mb-8 max-w-prose text-base text-foreground-secondary">
		This page imports the components themselves, so it can't drift from the code the way a
		hand-written reference would. If something looks wrong here, it is wrong in the app. The rules
		and rationale live in <code class="font-mono text-sm">docs/design-language.md</code>.
	</p>

	<div class="flex flex-col gap-10">
		<!-- ── Buttons ──────────────────────────────────────────────────── -->
		<Card title="Button">
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-2.5">
					<Eyebrow>Variants</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<Button variant="primary">Release decisions</Button>
						<Button variant="secondary">Export CSV</Button>
						<Button variant="ghost">Cancel</Button>
						<Button variant="danger">Delete event</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>Sizes — 28 / 32 / 40</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<Button variant="primary" size="sm">Small</Button>
						<Button variant="primary">Medium</Button>
						<Button variant="primary" size="lg">Large</Button>
						<Button size="sm">Small</Button>
						<Button>Medium</Button>
						<Button size="lg">Large</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>States — tab through these to see the focus halo</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<Button variant="primary" loading>Saving…</Button>
						<Button variant="primary" disabled>Disabled</Button>
						<Button disabled>Disabled</Button>
						<Button variant="danger" loading>Deleting…</Button>
						<Button href="/design">As a link</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>IconButton — requires a label</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<IconButton label="Close">✕</IconButton>
						<IconButton label="Edit" variant="secondary">✎</IconButton>
						<IconButton label="Remove entry" variant="danger">✕</IconButton>
						<Tooltip content="Tooltips explain icon-only controls">
							{#snippet children(props)}
								<IconButton label="More information" {...props}>?</IconButton>
							{/snippet}
						</Tooltip>
					</div>
				</div>
			</div>
		</Card>

		<!-- ── Badges ───────────────────────────────────────────────────── -->
		<Card title="Badge">
			<div class="flex flex-col gap-6">
				{#each ['subtle', 'solid', 'outline'] as const as variant (variant)}
					<div class="flex flex-col gap-2.5">
						<Eyebrow>{variant}</Eyebrow>
						<div class="flex flex-wrap items-center gap-2">
							{#each TONES as tone (tone)}
								<Badge {tone} {variant}>{tone}</Badge>
							{/each}
						</div>
					</div>
				{/each}

				<div class="flex flex-col gap-2.5">
					<Eyebrow>With a status dot</Eyebrow>
					<div class="flex flex-wrap items-center gap-2">
						<Badge tone="neutral" dot>Applied</Badge>
						<Badge tone="success" dot>Accepted</Badge>
						<Badge tone="warning" dot>Waitlisted</Badge>
						<Badge tone="danger" dot>Rejected</Badge>
						<Badge tone="info" dot>Checked in</Badge>
					</div>
				</div>
			</div>
		</Card>

		<!-- ── Form controls ────────────────────────────────────────────── -->
		<Card title="Field & controls">
			<div class="flex flex-col gap-6">
				<div class="grid gap-5 sm:grid-cols-2">
					<Input
						label="Email"
						placeholder="hacker@utexas.edu"
						bind:value={text}
						hint="Matched against the applicant's login address."
					/>
					<Input label="Starts" mono value="2026-09-19T12:00" readonly />
					<Input label="Value" bind:value={broken} error="Enter a valid email address." />
					<Input label="Locked" value="Under review by Ali" disabled />
					<Input label="Team size" type="number" value="4" required />
				</div>

				<Textarea
					label="Reason"
					placeholder="Shown to reviewers only"
					bind:value={notes}
					rows={3}
				/>

				<Divider label="Combobox — the only single-select control" />

				<!--
					There was briefly a second one, `Select`, a plain listbox for short lists.
					It went because the choice between them was never really the author's to
					make: it depends on how long the list grows, which is a runtime fact. A
					type-ahead over six options costs nothing, and a plain listbox over 6,447
					is unusable, so one control covers both ends.

					`allowCustom` is what a long-but-incomplete list needs: pick "Not listed"
					and the control becomes a text box, so nobody is blocked by a gap in the
					vocabulary. `clearable` offers the placeholder as a real row, for filter
					bars where "all of them" is a choice. Aliases are matched but never shown —
					try "UT Austin" or "A&M".
				-->
				<div class="grid gap-5 sm:grid-cols-2">
					<Combobox
						label="School"
						options={SCHOOLS}
						bind:value={school}
						placeholder="Search for your school"
						allowCustom
						customLabel="My school isn't listed"
						hint="Type an alias — “UT Austin”, “A&M” — not just the full name."
					/>
					<Combobox label="Role" options={ROLES} bind:value={role} />
					<Combobox
						ariaLabel="Filter by role"
						options={ROLES}
						bind:value={filterRole}
						placeholder="All roles"
						clearable
					/>
					<Combobox label="Disabled" options={SCHOOLS} value="Rice University" disabled />
				</div>

				<Divider label="Toggles" />

				<div class="flex flex-wrap items-center gap-8">
					<Checkbox bind:checked={agreed} label="Send a confirmation email" />
					<Checkbox checked={false} label="Disabled" disabled />
					<Switch bind:checked={notify} label="Notify on every scan" />
				</div>

				<Divider label="Custom control in a Field" />

				<Field label="Scan groups" hint="Applicants are scanned against these at check-in.">
					{#snippet children({ id })}
						<div {id} class="flex flex-wrap gap-2">
							<Badge tone="neutral">Check-in</Badge>
							<Badge tone="neutral">Lunch</Badge>
							<Badge tone="neutral">Dinner</Badge>
						</div>
					{/snippet}
				</Field>
			</div>
		</Card>

		<!-- ── Data display ─────────────────────────────────────────────── -->
		<Card title="StatCard" padding="md">
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard label="Applied" value={248} />
				<StatCard label="Accepted" value={142} tone="success" />
				<StatCard label="Waitlisted" value={61} tone="warning" />
				<StatCard label="Checked in" value={37} tone="info" hint="of 142 confirmed" />
			</div>
		</Card>

		<div class="flex flex-col gap-3">
			<Eyebrow>DataTable</Eyebrow>
			<DataTable columns={COLUMNS} rows={APPLICANTS} rowKey={(row) => row.uid}>
				{#snippet cell({ row, column })}
					{#if column.key === 'name'}
						<span class="font-medium">{row.name}</span>
					{:else if column.key === 'email'}
						<span class="text-sm text-foreground-secondary">{row.email}</span>
					{:else if column.key === 'role'}
						<span class="text-foreground-secondary">{row.role}</span>
					{:else if column.key === 'status'}
						<Badge tone={row.status}>{row.statusLabel}</Badge>
					{:else if column.key === 'decision'}
						<Badge tone={row.decision}>{row.decisionLabel}</Badge>
					{:else if column.key === 'createdAt'}
						<span class="font-mono text-xs text-foreground-tertiary tabular-nums">
							{formatDate(row.createdAt, { year: false })}
						</span>
					{/if}
				{/snippet}
			</DataTable>
			<Pagination {page} totalPages={6} onChange={(next) => (page = next)} />
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<div class="flex flex-col gap-3">
				<Eyebrow>EmptyState</Eyebrow>
				<Card padding="none">
					<EmptyState title="Blacklist" message="No entries yet. Add one, or import a CSV.">
						{#snippet action()}
							<Button size="sm">Import CSV</Button>
						{/snippet}
					</EmptyState>
				</Card>
			</div>

			<div class="flex flex-col gap-3">
				<Eyebrow>FilterGroup</Eyebrow>
				<Card>
					<FilterGroup title="Status" options={STATUS_OPTIONS} bind:selected={statuses} />
				</Card>
			</div>
		</div>

		<!-- ── Navigation ───────────────────────────────────────────────── -->
		<Card title="Tabs">
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-2.5">
					<Eyebrow>Horizontal — arrow keys move between tabs</Eyebrow>
					<Tabs tabs={TABS} bind:active={tab} />
					<p class="m-0 text-base text-foreground-secondary">Showing: {tab}</p>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>Vertical rail, with counts</Eyebrow>
					<div class="flex overflow-hidden rounded-lg border border-border">
						<Tabs tabs={VTABS} bind:active={vtab} orientation="vertical" />
						<div class="flex-1 bg-card p-5 text-base text-foreground-secondary">
							Showing: {vtab}
						</div>
					</div>
				</div>
			</div>
		</Card>

		<!-- ── Overlays & feedback ──────────────────────────────────────── -->
		<Card title="Overlays & feedback">
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-2.5">
					<Eyebrow>Modal & ConfirmDialog — focus is trapped and restored</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<Button onclick={() => (modalOpen = true)}>Open modal</Button>
						<Button variant="danger" onclick={() => (confirmOpen = true)}>
							Release decisions…
						</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>Toast — one store, one duration, stacks to three</Eyebrow>
					<div class="flex flex-wrap items-center gap-2.5">
						<Button size="sm" onclick={() => toast.success('Event added to the schedule')}>
							Success
						</Button>
						<Button size="sm" onclick={() => toast.error("Couldn't send — check the filter")}>
							Error
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onclick={() =>
								toast.fromError(new Error('Row 4: missing last name'), 'Import failed')}
						>
							From an error
						</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2.5">
					<Eyebrow>Spinner</Eyebrow>
					<div class="flex items-center gap-4 text-foreground-secondary">
						<Spinner size="sm" />
						<Spinner size="md" />
					</div>
				</div>
			</div>
		</Card>
	</div>
</div>

<Modal bind:open={modalOpen} title="Edit user" description="Priya Raman · priya.raman@utexas.edu">
	<div class="flex flex-col gap-5">
		<div class="grid grid-cols-2 gap-3">
			<Field label="Created">
				{#snippet children({ id })}
					<span {id} class="font-mono text-base text-foreground-secondary">Sep 12, 2026</span>
				{/snippet}
			</Field>
			<Field label="UID">
				{#snippet children({ id })}
					<span {id} class="font-mono text-xs break-all text-foreground-tertiary">
						clx8k2n40000qwer
					</span>
				{/snippet}
			</Field>
		</div>
		<Combobox label="Role" options={ROLES} bind:value={role} />
		<Checkbox bind:checked={agreed} label="Notify the applicant of this change" />
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (modalOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			onclick={() => {
				modalOpen = false;
				toast.success('User saved');
			}}
		>
			Save changes
		</Button>
	{/snippet}
</Modal>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Release decisions?"
	description="248 applicants will receive a decision email. This cannot be undone."
	confirmLabel="Release 248 decisions"
	confirmPhrase="RELEASE"
	loading={releasing}
	onConfirm={fakeRelease}
>
	<div class="flex flex-wrap gap-2">
		<Badge tone="success">142 accepted</Badge>
		<Badge tone="warning">61 waitlisted</Badge>
		<Badge tone="danger">45 rejected</Badge>
	</div>
</ConfirmDialog>
