<script lang="ts">
	import { untrack } from 'svelte';
	import type { CriterionDraft, LevelDraft, RubricCriterion } from '$lib/admissions/rubric';
	import { Button, Input, Modal } from '$lib/components/ui';

	let {
		criteria,
		saving,
		onSave,
		onClose
	}: {
		/** The saved rubric this editing session starts from. */
		criteria: RubricCriterion[];
		saving: boolean;
		onSave: (criteria: CriterionDraft[]) => void;
		onClose: () => void;
	} = $props();

	function newLevel(position: number): LevelDraft {
		// Prefilled with the sheet convention — a 1-based label worth its rank in points.
		return { label: `${position}`, description: '', points: position };
	}

	function newCriterion(): CriterionDraft {
		return { title: '', levels: [1, 2, 3, 4].map(newLevel) };
	}

	// Mounted per editing session (the caller wraps this in {#if}), so the draft seeds
	// once; ids ride along so a rename updates rather than recreates the row.
	let draft = $state<CriterionDraft[]>(
		untrack(() =>
			criteria.length > 0
				? criteria.map((c) => ({
						id: c.id,
						title: c.title,
						levels: c.levels.map((l) => ({
							id: l.id,
							label: l.label,
							description: l.description,
							points: l.points
						}))
					}))
				: [newCriterion()]
		)
	);

	function pointsValid(points: number | undefined): boolean {
		return points !== undefined && Number.isInteger(points) && points >= 0 && points <= 1000;
	}

	let valid = $derived(
		draft.length > 0 &&
			draft.every(
				(c) =>
					c.title.trim().length > 0 &&
					c.levels.length > 0 &&
					c.levels.every((l) => l.label.trim().length > 0 && pointsValid(l.points))
			)
	);

	function save() {
		if (!valid || saving) return;
		onSave($state.snapshot(draft));
	}
</script>

<Modal
	open={true}
	title="Scoring rubric"
	description="Each criterion is a row; each level is a clickable cell worth its points. Saved scores keep their totals — edits only affect future saves."
	size="2xl"
	dismissible={!saving}
	{onClose}
>
	<div class="flex flex-col gap-4">
		{#each draft as criterion, ci (criterion)}
			<div class="rounded-md border border-border bg-card p-3.5">
				<div class="flex items-center gap-2">
					<Input
						bind:value={criterion.title}
						placeholder="Criterion, e.g. “Why do you want to attend?”"
						aria-label="Criterion title"
						class="flex-1 font-semibold"
						disabled={saving}
					/>
					<Button
						size="sm"
						variant="ghost"
						disabled={saving}
						onclick={() => (draft = draft.filter((_, i) => i !== ci))}
						aria-label="Remove criterion"
					>
						✕
					</Button>
				</div>

				<div class="mt-2.5 flex flex-col gap-1.5">
					{#each criterion.levels as level, li (level)}
						<div class="flex items-start gap-2">
							<Input
								bind:value={level.label}
								placeholder="Label, e.g. 1 - Poor"
								aria-label="Level label"
								class="w-36"
								disabled={saving}
							/>
							<!-- Raw input: Svelte's number coercion needs a literal type attribute,
							     which the Input component's spread can't provide. -->
							<input
								type="number"
								inputmode="numeric"
								step="1"
								min="0"
								max="1000"
								bind:value={level.points}
								aria-label="Points"
								aria-invalid={!pointsValid(level.points)}
								disabled={saving}
								class="w-20 rounded-md border bg-card px-2.5 py-1.5 text-center font-mono text-touch
								       tabular-nums outline-none focus-visible:shadow-ring sm:text-base
								       {pointsValid(level.points) ? 'border-border' : 'border-danger-500'}"
							/>
							<Input
								bind:value={level.description}
								placeholder="What earns this level"
								aria-label="Level description"
								class="flex-1"
								disabled={saving}
							/>
							<Button
								size="sm"
								variant="ghost"
								class="mt-0.5"
								disabled={saving || criterion.levels.length === 1}
								onclick={() => (criterion.levels = criterion.levels.filter((_, i) => i !== li))}
								aria-label="Remove level"
							>
								✕
							</Button>
						</div>
					{/each}
				</div>

				<Button
					size="sm"
					class="mt-2"
					disabled={saving}
					onclick={() => criterion.levels.push(newLevel(criterion.levels.length + 1))}
				>
					+ Add level
				</Button>
			</div>
		{/each}

		<Button disabled={saving} onclick={() => draft.push(newCriterion())} class="self-start">
			+ Add criterion
		</Button>
	</div>

	{#snippet footer()}
		<Button onclick={onClose} disabled={saving}>Cancel</Button>
		<Button variant="primary" loading={saving} disabled={!valid} onclick={save}>Save rubric</Button>
	{/snippet}
</Modal>
