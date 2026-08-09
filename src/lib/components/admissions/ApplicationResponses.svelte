<script lang="ts">
	let {
		responses
	}: {
		responses: Array<{ value: string; question: { title: string; order: number } }>;
	} = $props();

	// Sorted here rather than at each call site: the review pane and the ranked
	// list's read-only view show the same application, and an answer order that
	// differed between the scoring pass and the decision pass would read as two
	// different applications.
	let sorted = $derived([...responses].sort((a, b) => a.question.order - b.question.order));
</script>

{#if sorted.length === 0}
	<div class="text-[13px] text-muted-foreground italic">No application responses.</div>
{:else}
	<div class="flex flex-col gap-5">
		{#each sorted as response (response.question.title)}
			<div>
				<div class="mb-1.5 text-xs font-semibold text-[#555]">
					{response.question.title}
				</div>
				<div
					class="rounded border border-border bg-[#f9f9f9] px-3 py-[10px] text-[13px] leading-[1.5] break-words whitespace-pre-wrap text-primary"
				>
					{response.value || '—'}
				</div>
			</div>
		{/each}
	</div>
{/if}
