<script lang="ts">
	import { QuestionType } from '$lib/generated/prisma/enums';
	import type { QuestionModel } from '$lib/generated/prisma/models/Question';

	interface Props {
		question: QuestionModel;
		value: string;
		onchange: (value: string) => void;
	}

	let { question, value, onchange }: Props = $props();

	const inputClass =
		'w-full rounded border px-3 py-2 text-sm outline-none transition-colors focus:border-[#191919]';
	const inputStyle = 'border-color: #e0e0e0; background: #fff; color: #191919;';

	// Use question id as the form element id
	const inputId = $derived(`q-${question.id}`);
</script>

<div class="flex flex-col gap-1.5">
	{#if question.type === QuestionType.CHECKBOX || question.type === QuestionType.MULTIPLE_CHOICE}
		<!-- For checkbox/radio, label is rendered per-item below; show title separately -->
		<p class="text-sm font-medium" style="color: #191919">
			{question.title}
			{#if question.required}
				<span class="ml-0.5" style="color: #b00000">*</span>
			{/if}
		</p>
	{:else}
		<label for={inputId} class="text-sm font-medium" style="color: #191919">
			{question.title}
			{#if question.required}
				<span class="ml-0.5" style="color: #b00000">*</span>
			{/if}
		</label>
	{/if}

	{#if question.type === QuestionType.SHORT_TEXT}
		<input
			id={inputId}
			type="text"
			class={inputClass}
			style={inputStyle}
			placeholder={question.placeholder ?? ''}
			{value}
			oninput={(e) => onchange((e.target as HTMLInputElement).value)}
		/>

	{:else if question.type === QuestionType.LONG_TEXT}
		<textarea
			id={inputId}
			class="{inputClass} resize-none"
			style={inputStyle}
			rows={4}
			placeholder={question.placeholder ?? ''}
			value={value}
			oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
		></textarea>

	{:else if question.type === QuestionType.NUMBER}
		<input
			id={inputId}
			type="number"
			class={inputClass}
			style={inputStyle}
			placeholder={question.placeholder ?? ''}
			min={question.min ?? undefined}
			max={question.max ?? undefined}
			{value}
			oninput={(e) => onchange((e.target as HTMLInputElement).value)}
		/>

	{:else if question.type === QuestionType.CHECKBOX}
		<label class="flex cursor-pointer items-center gap-2 text-sm" style="color: #191919">
			<input
				type="checkbox"
				checked={value === 'true'}
				onchange={(e) => onchange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
				class="h-4 w-4 rounded"
				style="accent-color: #191919"
			/>
			{question.placeholder ?? 'Yes'}
		</label>

	{:else if question.type === QuestionType.MULTIPLE_CHOICE}
		<div class="flex flex-col gap-2">
			{#each question.options as option}
				<label class="flex cursor-pointer items-center gap-2 text-sm" style="color: #191919">
					<input
						type="radio"
						name={question.id}
						value={option}
						checked={value === option}
						onchange={() => onchange(option)}
						style="accent-color: #191919"
					/>
					{option}
				</label>
			{/each}
		</div>

	{:else if question.type === QuestionType.DROPDOWN}
		<select
			id={inputId}
			class={inputClass}
			style={inputStyle}
			onchange={(e) => onchange((e.target as HTMLSelectElement).value)}
		>
			<option value="" disabled selected={!value}>{question.placeholder ?? 'Select an option'}</option>
			{#each question.options as option}
				<option value={option} selected={value === option}>{option}</option>
			{/each}
		</select>
	{/if}
</div>
