<script lang="ts">
	import {
		MAX_DELTA,
		rubricComplete,
		rubricMaxScore,
		rubricSubtotal,
		type RubricCriterion
	} from '$lib/admissions/rubric';
	import { Button, Modal } from '$lib/components/ui';

	let {
		open = $bindable(false),
		criteria,
		selections = $bindable(),
		delta = $bindable(),
		saving,
		onSave,
		saveLabel
	}: {
		open?: boolean;
		criteria: RubricCriterion[];
		/** criterionId → picked levelId. Owned by the caller so a closed modal keeps the picks. */
		selections: Record<string, string | undefined>;
		/** Manual adjustment on top of the rubric subtotal. Undefined while the field is cleared. */
		delta: number | undefined;
		saving: boolean;
		onSave: () => void;
		saveLabel: string;
	} = $props();

	let maxLevels = $derived(Math.max(0, ...criteria.map((c) => c.levels.length)));
	let subtotal = $derived(rubricSubtotal(criteria, selections));
	let complete = $derived(rubricComplete(criteria, selections));
	let maxScore = $derived(rubricMaxScore(criteria));

	let deltaValid = $derived(
		delta === undefined || (Number.isInteger(delta) && Math.abs(delta) <= MAX_DELTA)
	);
	let total = $derived(subtotal + (deltaValid ? (delta ?? 0) : 0));
	let canSave = $derived(complete && deltaValid && !saving);

	function toggle(criterionId: string, levelId: string) {
		selections[criterionId] = selections[criterionId] === levelId ? undefined : levelId;
	}

	function pointsFor(criterion: RubricCriterion): number | null {
		const level = criterion.levels.find((l) => l.id === selections[criterion.id]);
		return level?.points ?? null;
	}
</script>

<Modal bind:open title="Score with rubric" size="2xl" bodyClass="px-0 py-0">
	<div class="overflow-x-auto px-6 py-5">
		<div
			class="grid gap-1.5"
			style="grid-template-columns: minmax(150px, 1.1fr) repeat({maxLevels}, minmax(130px, 1fr)) 56px;"
		>
			{#each criteria as criterion (criterion.id)}
				<div class="flex items-center py-1 pr-2 text-xs font-semibold text-foreground">
					{criterion.title}
				</div>

				{#each criterion.levels as level (level.id)}
					{@const picked = selections[criterion.id] === level.id}
					<button
						type="button"
						aria-pressed={picked}
						onclick={() => toggle(criterion.id, level.id)}
						class="cursor-pointer rounded-md border p-2 text-left text-2xs transition-colors duration-150
						       focus-visible:shadow-ring
						       {picked ? 'border-[#818cf8] bg-[#eef2ff]' : 'border-border bg-card hover:bg-muted'}"
					>
						<div class="font-semibold {picked ? 'text-[#3730a3]' : 'text-foreground'}">
							{level.label}
							<span
								class="font-mono font-normal {picked
									? 'text-[#6366f1]'
									: 'text-foreground-tertiary'}"
							>
								· {level.points} pt{level.points === 1 ? '' : 's'}
							</span>
						</div>
						{#if level.description}
							<div class="mt-0.5 text-foreground-secondary">{level.description}</div>
						{/if}
					</button>
				{/each}

				<!-- Ragged rows: pad so the points column stays a column. -->
				{#each { length: maxLevels - criterion.levels.length } as _, i (i)}
					<div></div>
				{/each}

				<div
					class="flex items-center justify-end py-1 font-mono text-xs tabular-nums
					       {pointsFor(criterion) === null
						? 'text-foreground-tertiary'
						: 'font-semibold text-foreground'}"
				>
					{pointsFor(criterion) ?? '—'}
				</div>
			{/each}
		</div>
	</div>

	{#snippet footer()}
		<div class="mr-auto flex items-center gap-2 text-xs text-foreground-secondary">
			<span class="font-mono tabular-nums">
				{complete ? subtotal : '—'}
			</span>
			<span>rubric</span>
			<span aria-hidden="true">+</span>
			<label for="rubric-delta" class="sr-only">Score adjustment</label>
			<input
				id="rubric-delta"
				type="number"
				inputmode="numeric"
				step="1"
				min={-MAX_DELTA}
				max={MAX_DELTA}
				bind:value={delta}
				disabled={saving}
				aria-invalid={!deltaValid}
				class="w-16 rounded-md border bg-card px-2 py-1 text-center font-mono text-xs tabular-nums
				       outline-none focus-visible:shadow-ring
				       {deltaValid ? 'border-border' : 'border-danger-500'}"
			/>
			<span>adjustment</span>
			<span aria-hidden="true">=</span>
			<span class="font-mono text-base font-semibold text-foreground tabular-nums">
				{complete ? total : '—'}<span class="text-xs font-normal text-foreground-tertiary"
					>/{maxScore}</span
				>
			</span>
		</div>
		<Button variant="primary" loading={saving} disabled={!canSave} onclick={onSave}>
			{saveLabel}
		</Button>
	{/snippet}
</Modal>
