<script lang="ts">
	import { QuestionType } from '$lib/generated/prisma/enums';
	import FileAnswer from '$lib/components/files/FileAnswer.svelte';
	import { decodeMultiSelect } from '$lib/questions/multiSelect';

	let {
		responses
	}: {
		responses: Array<{
			value: string;
			userId: string;
			questionId: string;
			question: { title: string; order: number; type: string };
		}>;
	} = $props();

	// Sorted here, not per call site, so the scoring and decision passes show the same order.
	let sorted = $derived([...responses].sort((a, b) => a.question.order - b.question.order));

	/** A MULTI_SELECT stores JSON, which is not what a reviewer should be reading. */
	function display(response: (typeof sorted)[number]): string {
		if (response.question.type !== QuestionType.MULTI_SELECT) return response.value;
		return decodeMultiSelect(response.value).join(', ');
	}
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
				{#if response.question.type === QuestionType.FILE && response.value.trim() !== ''}
					<!-- A link, not text: the value is a filename, and the route re-checks access. -->
					<FileAnswer
						userId={response.userId}
						questionId={response.questionId}
						filename={response.value}
						class="inline-block rounded border border-border bg-[#f9f9f9] px-3 py-[10px] text-[13px] leading-[1.5] text-primary underline underline-offset-2 hover:bg-white"
					/>
				{:else}
					<div
						class="rounded border border-border bg-[#f9f9f9] px-3 py-[10px] text-[13px] leading-[1.5] break-words whitespace-pre-wrap text-primary"
					>
						{display(response) || '—'}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
