<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, Eyebrow, MultiCombobox } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/patterns';
	import LinkedFieldFilters from '$lib/components/admin/LinkedFieldFilters.svelte';
	import { MAX_FACET_OPTIONS, type LinkedFacet, type LinkedField } from '$lib/linkedFields';

	/**
	 * Specimens for the linked-field filter controls, rendered from the real
	 * components against a fixed copy of the shape the server sends.
	 *
	 * Counts and spellings are taken from the seeded data, near-duplicates included:
	 * the two spellings of UT Austin are the whole reason counts are on screen.
	 */
	const UNIVERSITIES = [
		{ value: 'The University of Texas at Austin', count: 408 },
		{ value: 'University of Texas at Austin', count: 120 },
		{ value: 'Texas A&M University', count: 96 },
		{ value: 'University of Texas at Dallas', count: 74 },
		{ value: 'Rice University', count: 41 },
		{ value: 'University of Houston', count: 33 },
		{ value: 'Massachusetts Institute of Technology', count: 12 },
		{ value: 'Stanford University', count: 9 }
	];

	const UNIVERSITY_FACET: LinkedFacet = {
		field: 'UNIVERSITY',
		label: 'University',
		control: 'combobox',
		options: UNIVERSITIES,
		noneCount: 530
	};

	/** Year as a dropdown question: an enumerated vocabulary, so a checkbox list. */
	const YEAR_SELECT_FACET: LinkedFacet = {
		field: 'YEAR',
		label: 'Year',
		control: 'select',
		options: [
			{ value: 'Freshman', count: 214 },
			{ value: 'Sophomore', count: 188 },
			{ value: 'Junior', count: 141 },
			{ value: 'Senior', count: 97 },
			{ value: 'Graduate', count: 44 },
			{ value: 'Alumni', count: 18 }
		],
		noneCount: 529
	};

	/**
	 * The Full Name facet: one option per person, so the server caps it and sets
	 * `truncated`. The names below are synthetic; only the shape matters.
	 */
	const FIRST = ['Sarah', 'Marcus', 'Priya', 'Dani', 'Sam', 'Ana', 'Leo', 'Mia', 'Noah', 'Zoe'];
	const LAST = ['Chen', 'Webb', 'Raman', 'Okonkwo', 'Ortega', 'Silva', 'Novak', 'Haddad'];

	const NAME_FACET: LinkedFacet = {
		field: 'NAME',
		label: 'Full name',
		control: 'combobox',
		options: Array.from({ length: MAX_FACET_OPTIONS }, (_, i) => ({
			value: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${
				i < FIRST.length * LAST.length ? '' : ` ${Math.floor(i / (FIRST.length * LAST.length))}`
			}`,
			count: 1
		})),
		noneCount: 0,
		truncated: true
	};

	/**
	 * The same field after an organizer switched the question to Short Text. Only
	 * `control` and the vocabulary differ; the component is not told which is which.
	 */
	const YEAR_COMBOBOX_FACET: LinkedFacet = {
		...YEAR_SELECT_FACET,
		control: 'combobox',
		options: [
			{ value: 'Freshman', count: 214 },
			{ value: 'sophomore', count: 96 },
			{ value: 'Sophomore', count: 92 },
			{ value: '3rd year', count: 88 },
			{ value: 'Junior', count: 53 },
			{ value: 'Senior', count: 97 }
		]
	};

	let bare = $state<string[]>([]);
	let preselected = $state<string[]>(['Rice University']);
	let disabledSelection = $state<string[]>(['Stanford University']);

	let railSelection = $state<Partial<Record<LinkedField, string[]>>>({});
	let inlineSelection = $state<Partial<Record<LinkedField, string[]>>>({});
	let switchedSelection = $state<Partial<Record<LinkedField, string[]>>>({});
	let emptySelection = $state<Partial<Record<LinkedField, string[]>>>({});
	let truncatedSelection = $state<Partial<Record<LinkedField, string[]>>>({});

	let lastChange = $state('—');
</script>

<svelte:head><title>Rodeo — Linked field filters</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
	<PageHeader
		title="Linked field filters"
		subtitle="MultiCombobox and LinkedFieldFilters, driven by the LinkedFacet contract."
	>
		{#snippet actions()}
			<a
				href={resolve('/design')}
				class="text-base text-foreground-secondary underline hover:text-foreground
				       focus-visible:shadow-ring">Back to the design system</a
			>
		{/snippet}
	</PageHeader>

	<div class="flex flex-col gap-10">
		<Card title="MultiCombobox">
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-2.5" data-testid="combobox-labelled">
					<Eyebrow>With a label, counts, and a hint</Eyebrow>
					<MultiCombobox
						label="University"
						hint="Type to search. Misspellings still match."
						options={UNIVERSITIES}
						bind:selected={bare}
						onChange={(next) => (lastChange = next.join(' | ') || '(none)')}
					/>
					<p class="m-0 text-xs text-foreground-tertiary">
						onChange: <span class="font-mono" data-testid="last-change">{lastChange}</span>
					</p>
				</div>

				<div class="flex flex-col gap-2.5" data-testid="combobox-preselected">
					<Eyebrow>Pre-selected, no label — takes an ariaLabel instead</Eyebrow>
					<MultiCombobox
						ariaLabel="University, unlabelled"
						options={UNIVERSITIES}
						bind:selected={preselected}
					/>
				</div>

				<div class="grid gap-5 sm:grid-cols-2">
					<div class="flex flex-col gap-2.5" data-testid="combobox-disabled">
						<Eyebrow>Disabled</Eyebrow>
						<MultiCombobox
							ariaLabel="University, disabled"
							options={UNIVERSITIES}
							bind:selected={disabledSelection}
							disabled
						/>
					</div>
					<div class="flex flex-col gap-2.5" data-testid="combobox-error">
						<Eyebrow>Invalid</Eyebrow>
						<MultiCombobox
							label="University"
							error="Pick at least one."
							options={UNIVERSITIES}
							selected={[]}
						/>
					</div>
				</div>
			</div>
		</Card>

		<Card title="LinkedFieldFilters — the Users left rail">
			<div class="flex flex-col gap-2.5" data-testid="filters-rail">
				<LinkedFieldFilters
					facets={[UNIVERSITY_FACET, YEAR_SELECT_FACET]}
					bind:selected={railSelection}
					heading="Application"
				/>
				<p class="m-0 text-xs text-foreground-tertiary">
					selected: <span class="font-mono" data-testid="rail-selection"
						>{JSON.stringify(railSelection)}</span
					>
				</p>
			</div>
		</Card>

		<Card title="LinkedFieldFilters — inline, side by side">
			<div data-testid="filters-inline">
				<LinkedFieldFilters
					facets={[UNIVERSITY_FACET, YEAR_SELECT_FACET]}
					bind:selected={inlineSelection}
					columns
					collapsible
				/>
			</div>
		</Card>

		<Card title="LinkedFieldFilters — Year switched to Short Text">
			<div class="flex flex-col gap-2.5" data-testid="filters-switched">
				<p class="m-0 text-base text-foreground-secondary">
					Identical component and identical props. Only <code class="font-mono text-sm"
						>facet.control</code
					> changed, and the checkbox list above became a type-ahead.
				</p>
				<LinkedFieldFilters
					facets={[YEAR_COMBOBOX_FACET]}
					bind:selected={switchedSelection}
					heading="Application"
				/>
			</div>
		</Card>

		<Card title="LinkedFieldFilters — a truncated facet">
			<div class="flex flex-col gap-2.5" data-testid="filters-truncated">
				<p class="m-0 text-base text-foreground-secondary">
					One option per person, capped by the server. The list says so, and says how much of itself
					it is not showing.
				</p>
				<LinkedFieldFilters
					facets={[NAME_FACET]}
					bind:selected={truncatedSelection}
					heading="Application"
				/>
			</div>
		</Card>

		<Card title="LinkedFieldFilters — no facets">
			<div data-testid="filters-empty">
				<p class="m-0 text-base text-foreground-secondary">
					Nothing renders below this line when no question is linked.
				</p>
				<LinkedFieldFilters facets={[]} bind:selected={emptySelection} heading="Application" />
			</div>
		</Card>
	</div>
</div>
