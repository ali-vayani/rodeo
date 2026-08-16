<script lang="ts">
	import { QuestionType } from '$lib/generated/prisma/enums';
	import type { QuestionModel } from '$lib/generated/prisma/models/Question';
	import { Combobox } from '$lib/components/ui';
	import type { ComboboxOption } from '$lib/components/ui/types';
	import { loadPresetOptions } from '$lib/questions/presetOptions';
	import { hasPresetOptions } from '$lib/questions/options';

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

	/**
	 * The choices for a dropdown, from the preset when there is one.
	 *
	 * A promise rather than resolved state because the university preset is a lazy
	 * 650 KB import — see `$lib/data/universities`. A question with hand-authored
	 * options resolves immediately and the `{#await}` never renders its pending arm.
	 */
	const choices = $derived<Promise<ComboboxOption[]>>(
		question.optionPreset !== null && hasPresetOptions(question)
			? loadPresetOptions(question.optionPreset)
			: Promise.resolve(question.options.map((option) => ({ value: option })))
	);
</script>

<div class="flex flex-col gap-1.5">
	{#if question.type === QuestionType.CHECKBOX || question.type === QuestionType.MULTIPLE_CHOICE || question.type === QuestionType.DROPDOWN}
		<!--
			For checkbox/radio the label is rendered per-item below. A dropdown is here for
			a different reason: `Combobox` owns its own input element and generates its own
			id, so a `for` pointing at `inputId` would dangle. It takes the title as an
			`ariaLabel` instead, and this is the visible half of that.
		-->
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
		<!--
			Every dropdown is searchable, whether it holds six options or 6,447. A
			type-ahead over six costs nothing; a plain `<select>` over 6,447 is unusable.
			Making that the control's problem rather than a second question type is what
			stops an organizer from having to predict which one they'll need.

			`allowCustom` only for a preset-backed question, matching `acceptsWriteIn` on
			the server: a preset is a vocabulary the applicant may step outside of, while
			hand-authored options are the four choices an organizer meant. Offering a
			write-in for the latter would produce answers the server then rejects.
		-->
		{#await choices}
			<div class={inputClass}>Loading options…</div>
		{:then options}
			<Combobox
				{options}
				{value}
				{disabled}
				ariaLabel={question.title}
				placeholder={question.placeholder ?? 'Search…'}
				allowCustom={hasPresetOptions(question)}
				customLabel="Not listed — enter it myself"
				onChange={onchange}
			/>
		{/await}
	{/if}
</div>
