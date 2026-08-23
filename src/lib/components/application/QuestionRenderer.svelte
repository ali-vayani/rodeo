<script lang="ts">
	import { QuestionType } from '$lib/generated/prisma/enums';
	import type { QuestionModel } from '$lib/generated/prisma/models/Question';
	import { Combobox } from '$lib/components/ui';
	import FileAnswer from '$lib/components/files/FileAnswer.svelte';
	import { UPLOAD_ACCEPT } from '$lib/application/files';
	import type { ComboboxOption } from '$lib/components/ui/types';
	import { loadPresetOptions } from '$lib/questions/presetOptions';
	import { hasPresetOptions } from '$lib/questions/options';

	interface Props {
		question: QuestionModel;
		value: string;
		onchange: (value: string) => void;
		/**
		 * Receives the chosen file for a FILE question, instead of `onchange`. Separate
		 * because this one has bytes to send to a different endpoint before there is any
		 * answer to record, where the others round-trip a string the page autosaves.
		 */
		onfile?: (file: File) => void;
		/**
		 * Whose application this is. Only a FILE question uses it, to link the answer —
		 * `value` holds the uploaded file's name, not the file.
		 */
		ownerId: string;
		/**
		 * Renders the answer read-only. Set when the application window is shut, where
		 * every autosave would be refused by the server. An editable field that silently
		 * discards what you type is worse than a locked one.
		 */
		disabled?: boolean;
	}

	let { question, value, onchange, onfile, ownerId, disabled = false }: Props = $props();

	const inputClass = $derived(
		'w-full border border-border px-3.5 py-2.5 text-md text-foreground bg-card outline-none ' +
			'transition-colors duration-150 focus:border-brand-purple focus-visible:shadow-ring' +
			(disabled ? ' cursor-not-allowed bg-muted text-muted-foreground' : '')
	);

	const inputId = $derived(`q-${question.id}`);

	/**
	 * The choices for a dropdown, from the preset when there is one.
	 *
	 * A promise rather than resolved state because the university preset is a lazy 650 KB
	 * import. Hand-authored options resolve immediately.
	 */
	const choices = $derived<Promise<ComboboxOption[]>>(
		question.optionPreset !== null && hasPresetOptions(question)
			? loadPresetOptions(question.optionPreset)
			: Promise.resolve(question.options.map((option) => ({ value: option })))
	);
</script>

<div class="flex flex-col gap-2">
	{#if question.type === QuestionType.CHECKBOX || question.type === QuestionType.MULTIPLE_CHOICE || question.type === QuestionType.DROPDOWN}
		<!--
					For checkbox/radio the label is rendered per-item below. A dropdown is here
					because `Combobox` owns its own input and generates its own id, so a `for`
					pointing at `inputId` would dangle. It takes the title as an `ariaLabel` instead.
				-->
		<p class="text-base font-semibold text-foreground">
			{question.title}
			{#if question.required}
				<span class="ml-0.5 text-brand-orange">*</span>
			{/if}
		</p>
	{:else}
		<label for={inputId} class="text-base font-semibold text-foreground">
			{question.title}
			{#if question.required}
				<span class="ml-0.5 text-brand-orange">*</span>
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
			class="flex items-center gap-2 text-md text-foreground {disabled
				? 'cursor-not-allowed text-muted-foreground'
				: 'cursor-pointer'}"
		>
			<input
				type="checkbox"
				checked={value === 'true'}
				{disabled}
				onchange={(e) => onchange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
				class="h-4 w-4 accent-brand-purple"
			/>
			{question.placeholder ?? 'Yes'}
		</label>
	{:else if question.type === QuestionType.MULTIPLE_CHOICE}
		<div class="flex flex-col gap-2">
			{#each question.options as option (option)}
				<label
					class="flex items-center gap-2 text-md text-foreground {disabled
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
						class="accent-brand-purple"
					/>
					{option}
				</label>
			{/each}
		</div>
	{:else if question.type === QuestionType.DROPDOWN}
		<!--
					Every dropdown is searchable, whether it holds six options or 6,447. A type-ahead
					over six costs nothing; a plain `<select>` over 6,447 is unusable.

					`allowCustom` only for a preset-backed question, matching `acceptsWriteIn` on the
					server: a preset is a vocabulary the applicant may step outside of, while
					hand-authored options are the four choices an organizer meant.
				-->
		{#await choices}
			<div class={inputClass}>Loading options…</div>
		{:then options}
			<Combobox
				{options}
				{value}
				{disabled}
				class="rounded-none"
				ariaLabel={question.title}
				placeholder={question.placeholder ?? 'Search…'}
				allowCustom={hasPresetOptions(question)}
				customLabel="Not listed — enter it myself"
				onChange={onchange}
			/>
		{/await}
	{:else if question.type === QuestionType.FILE}
		<!-- `value` is the uploaded file's name, not a path. Picking a new one replaces it. -->
		{#if value}
			<p class="text-base text-foreground-secondary">
				Uploaded:
				<FileAnswer
					userId={ownerId}
					questionId={question.id}
					filename={value}
					class="font-medium text-brand-purple underline underline-offset-2"
				/>
			</p>
		{/if}
		<input
			id={inputId}
			type="file"
			accept={UPLOAD_ACCEPT}
			class="file: w-full border border-dashed border-border bg-brand-well p-3.5
				text-base text-foreground-secondary file:mr-3 file:cursor-pointer file:border
				file:border-border file:bg-card file:px-3 file:py-1.5 file:font-display file:text-base
				file:font-semibold file:text-foreground {disabled
				? 'cursor-not-allowed text-muted-foreground'
				: 'file:cursor-pointer'}"
			{disabled}
			onchange={(e) => {
				const input = e.target as HTMLInputElement;
				const file = input.files?.[0];
				if (file) onfile?.(file);
				// Clear it so re-picking the same file fires `change` again, letting a
				// failed upload be retried.
				input.value = '';
			}}
		/>
	{/if}
</div>
