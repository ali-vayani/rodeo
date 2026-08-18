<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, Eyebrow, MultiCombobox } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/patterns';
	import FacetFilters from '$lib/components/admin/FacetFilters.svelte';
	import {
		MAX_FACET_OPTIONS,
		OUT_OF_STATE,
		STATE_FACET_KEY,
		linkedFacetKey,
		questionFacetKey,
		type Facet,
		type FacetState
	} from '$lib/facets';

	/**
	 * Specimens for the application-answer filter controls, rendered from the real
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

	const UNIVERSITY_FACET: Facet = {
		key: linkedFacetKey('UNIVERSITY'),
		label: 'University',
		control: 'combobox',
		options: UNIVERSITIES,
		noneCount: 530
	};

	/** Year as a dropdown question: an enumerated vocabulary, so a checkbox list. */
	const YEAR_SELECT_FACET: Facet = {
		key: linkedFacetKey('YEAR'),
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

	const NAME_FACET: Facet = {
		key: linkedFacetKey('NAME'),
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
	const YEAR_COMBOBOX_FACET: Facet = {
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

	/**
	 * The state facet. Derived from each applicant's university rather than asked, and
	 * labelled from the home state in Settings — which is why the rows read "Texas" and
	 * "Outside Texas" rather than "Home" and "Away".
	 *
	 * Two rows and no more, deliberately: the question an organizer asks of an applicant
	 * pool is "local or travelling", and a row per state buried that under a list. The
	 * international applicants are inside "Outside Texas" rather than beside it, so these
	 * two plus `noneCount` partition the table.
	 */
	const STATE_FACET: Facet = {
		key: STATE_FACET_KEY,
		label: 'State',
		control: 'select',
		options: [
			{ value: 'TX', label: 'Texas', count: 812 },
			{ value: OUT_OF_STATE, label: 'Outside Texas', count: 231 }
		],
		noneCount: 530
	};

	/** A short-text question: no vocabulary worth listing, so a substring box. */
	const REFERRAL_FACET: Facet = {
		key: questionFacetKey('cmq0referral'),
		label: 'How did you hear about us?',
		control: 'search',
		options: [],
		noneCount: 0
	};

	/** A number question: two bounds, captioned with what the answers actually span. */
	const HACKATHONS_FACET: Facet = {
		key: questionFacetKey('cmq0hackathons'),
		label: 'Hackathons attended',
		control: 'range',
		options: [],
		noneCount: 0,
		bounds: { min: 0, max: 14 }
	};

	/** A checkbox question. Stored as 'true'/'false', shown as Yes/No. */
	const SHIRT_FACET: Facet = {
		key: questionFacetKey('cmq0shirt'),
		label: 'Needs travel reimbursement',
		control: 'select',
		options: [
			{ value: 'true', label: 'Yes', count: 402 },
			{ value: 'false', label: 'No', count: 688 }
		],
		noneCount: 762
	};

	let bare = $state<string[]>([]);
	let preselected = $state<string[]>(['Rice University']);
	let disabledSelection = $state<string[]>(['Stanford University']);

	let railSelection = $state<FacetState>({});
	let inlineSelection = $state<FacetState>({});
	let switchedSelection = $state<FacetState>({});
	let emptySelection = $state<FacetState>({});
	let truncatedSelection = $state<FacetState>({});

	let controlsSelection = $state<FacetState>({});

	let lastChange = $state('—');
</script>

<svelte:head><title>Rodeo — Answer filters</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
	<PageHeader
		title="Answer filters"
		subtitle="MultiCombobox and FacetFilters, driven by the Facet contract."
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

		<Card title="FacetFilters — the Users left rail">
			<div class="flex flex-col gap-2.5" data-testid="filters-rail">
				<FacetFilters
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

		<Card title="FacetFilters — inline, side by side">
			<div data-testid="filters-inline">
				<FacetFilters
					facets={[UNIVERSITY_FACET, YEAR_SELECT_FACET]}
					bind:selected={inlineSelection}
					columns
					collapsible
				/>
			</div>
		</Card>

		<Card title="FacetFilters — Year switched to Short Text">
			<div class="flex flex-col gap-2.5" data-testid="filters-switched">
				<p class="m-0 text-base text-foreground-secondary">
					Identical component and identical props. Only <code class="font-mono text-sm"
						>facet.control</code
					> changed, and the checkbox list above became a type-ahead.
				</p>
				<FacetFilters
					facets={[YEAR_COMBOBOX_FACET]}
					bind:selected={switchedSelection}
					heading="Application"
				/>
			</div>
		</Card>

		<Card title="FacetFilters — a truncated facet">
			<div class="flex flex-col gap-2.5" data-testid="filters-truncated">
				<p class="m-0 text-base text-foreground-secondary">
					One option per person, capped by the server. The list says so, and says how much of itself
					it is not showing.
				</p>
				<FacetFilters
					facets={[NAME_FACET]}
					bind:selected={truncatedSelection}
					heading="Application"
				/>
			</div>
		</Card>

		<Card title="FacetFilters — every control at once">
			<div class="flex flex-col gap-2.5" data-testid="filters-controls">
				<p class="m-0 text-base text-foreground-secondary">
					A checkbox list, a type-ahead, a substring box, a numeric range and the derived state
					facet — one component, five controls, chosen from <code class="font-mono text-sm"
						>facet.control</code
					> alone.
				</p>
				<FacetFilters
					facets={[STATE_FACET, SHIRT_FACET, REFERRAL_FACET, HACKATHONS_FACET]}
					bind:selected={controlsSelection}
					heading="Application"
				/>
				<p class="m-0 text-xs text-foreground-tertiary">
					selected: <span class="font-mono" data-testid="controls-selection"
						>{JSON.stringify(controlsSelection)}</span
					>
				</p>
			</div>
		</Card>

		<Card title="FacetFilters — no facets">
			<div data-testid="filters-empty">
				<p class="m-0 text-base text-foreground-secondary">
					Nothing renders below this line when the form has nothing filterable on it.
				</p>
				<FacetFilters facets={[]} bind:selected={emptySelection} heading="Application" />
			</div>
		</Card>
	</div>
</div>
