<script lang="ts">
	import { QuestionType } from '$lib/generated/prisma/enums';
	import type { QuestionModel } from '$lib/generated/prisma/models/Question';

	interface Props {
		question: QuestionModel;
		value: string;
		onchange: (value: string) => void;
		/**
		 * Renders the answer read-only. Set when the application window is shut, where
		 * every autosave behind these fields would be refused by the server — an
		 * editable field that silently discards what you type is worse than a locked
		 * one, because you only find out at submit.
		 */
		disabled?: boolean;
	}

	let { question, value, onchange, disabled = false }: Props = $props();

	const inputClass = $derived(
		'w-full rounded border border-border px-3 py-2 text-sm text-primary bg-white outline-none transition-colors focus:border-primary' +
			(disabled ? ' cursor-not-allowed bg-muted text-muted-foreground' : '')
	);

	// Use question id as the form element id
	const inputId = $derived(`q-${question.id}`);
</script>

<div class="flex flex-col gap-1.5">
	{#if question.type === QuestionType.CHECKBOX || question.type === QuestionType.MULTIPLE_CHOICE}
		<!-- For checkbox/radio, label is rendered per-item below; show title separately -->
		<p class="text-sm font-medium text-primary">
			{question.title}
			{#if question.required}
				<span class="ml-0.5 text-destructive">*</span>
			{/if}
		</p>
	{:else}
		<label for={inputId} class="text-sm font-medium text-primary">
			{question.title}
			{#if question.required}
				<span class="ml-0.5 text-destructive">*</span>
			{/if}
		</label>
	{/if}

	{#if question.type === QuestionType.SHORT_TEXT}
		<input
			id={inputId}
			type="text"
			class={inputClass}
			placeholder={question.placeholder ?? ''}
			{value}
			{disabled}
			oninput={(e) => onchange((e.target as HTMLInputElement).value)}
		/>
	{:else if question.type === QuestionType.LONG_TEXT}
		<textarea
			id={inputId}
			class="{inputClass} resize-none"
			rows={4}
			placeholder={question.placeholder ?? ''}
			{value}
			{disabled}
			oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
		></textarea>
	{:else if question.type === QuestionType.NUMBER}
		<input
			id={inputId}
			type="number"
			class={inputClass}
			placeholder={question.placeholder ?? ''}
			min={question.min ?? undefined}
			max={question.max ?? undefined}
			{value}
			{disabled}
			oninput={(e) => onchange((e.target as HTMLInputElement).value)}
		/>
	{:else if question.type === QuestionType.CHECKBOX}
		<label
			class="flex items-center gap-2 text-sm text-primary {disabled
				? 'cursor-not-allowed text-muted-foreground'
				: 'cursor-pointer'}"
		>
			<input
				type="checkbox"
				checked={value === 'true'}
				{disabled}
				onchange={(e) => onchange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
				class="h-4 w-4 rounded accent-primary"
			/>
			{question.placeholder ?? 'Yes'}
		</label>
	{:else if question.type === QuestionType.MULTIPLE_CHOICE}
		<div class="flex flex-col gap-2">
			{#each question.options as option (option)}
				<label
					class="flex items-center gap-2 text-sm text-primary {disabled
						? 'cursor-not-allowed text-muted-foreground'
						: 'cursor-pointer'}"
				>
					<input
						type="radio"
						name={question.id}
						value={option}
						checked={value === option}
						{disabled}
						onchange={() => onchange(option)}
						class="accent-primary"
					/>
					{option}
				</label>
			{/each}
		</div>
	{:else if question.type === QuestionType.DROPDOWN}
		<select
			id={inputId}
			class={inputClass}
			{disabled}
			onchange={(e) => onchange((e.target as HTMLSelectElement).value)}
		>
			<option value="" disabled selected={!value}
				>{question.placeholder ?? 'Select an option'}</option
			>
			{#each question.options as option (option)}
				<option value={option} selected={value === option}>{option}</option>
			{/each}
		</select>
	{/if}
</div>
