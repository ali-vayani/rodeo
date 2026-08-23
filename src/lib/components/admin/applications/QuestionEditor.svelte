<script lang="ts">
	import type {
		LinkedField,
		OptionPreset,
		Question,
		QuestionType,
		Role
	} from '$lib/generated/prisma/client';
	import { LINKED_FIELDS, LINKED_FIELD_LABEL } from '$lib/linkedFields';
	import { OPTION_PRESET_LABEL } from '$lib/questions/options';
	import { defaultsFor } from '$lib/questions/linkedFieldDefaults';
	import { suggestLinkedField } from '$lib/questions/suggestLinkedField';
	import { Combobox } from '$lib/components/ui';

	interface Props {
		question: Question | null;
		/**
		 * Title and type carried over from the Add Question form. New questions only.
		 * Seeding `type` shows the type-dependent sections immediately.
		 */
		seed?: { title: string; type: QuestionType } | null;
		isOpen: boolean;
		onSave: (question: Partial<Question>) => void;
		onCancel: () => void;
	}

	let { question, seed = null, isOpen, onSave, onCancel }: Props = $props();

	const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
		{ value: 'SHORT_TEXT', label: 'Short Text' },
		{ value: 'LONG_TEXT', label: 'Long Text' },
		{ value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
		{ value: 'DROPDOWN', label: 'Dropdown' },
		{ value: 'NUMBER', label: 'Number' },
		{ value: 'CHECKBOX', label: 'Checkbox' },
		{ value: 'FILE', label: 'File Upload' }
	];

	const ALL_ROLES: Role[] = [
		'HACKER',
		'JUDGE',
		'MENTOR',
		'VOLUNTEER',
		'ORGANIZER',
		'ADMIN',
		'UNDECLARED'
	];

	// `''` is the "None" row: the control binds a string, and the enum has no member
	// for "not linked". Converted back to null on save.
	const LINKED_FIELD_CHOICES = [
		{ value: '', label: 'None' },
		...LINKED_FIELDS.map((field) => ({ value: field, label: LINKED_FIELD_LABEL[field] }))
	];

	let title = $state('');
	let type = $state<QuestionType>('SHORT_TEXT');
	let required = $state(false);
	let targetRole = $state<Role[]>([]);
	let placeholder = $state('');
	let options = $state<string[]>(['']);
	let min = $state<string>('');
	let max = $state<string>('');
	let regex = $state('');
	let linkedField = $state<LinkedField | ''>('');
	let optionPreset = $state<OptionPreset | null>(null);
	let errors = $state<Record<string, string>>({});
	let newOptionInput = $state('');

	// Keyed by field, not a boolean: dismissing the University chip must not suppress
	// the Year chip after the title is rewritten.
	let dismissed = $state<LinkedField | null>(null);

	/** Drives the note explaining where the type came from. */
	let appliedDefaults = $state(false);

	$effect(() => {
		if (isOpen) {
			if (question) {
				title = question.title;
				type = question.type;
				required = question.required;
				targetRole = [...question.targetRole];
				placeholder = question.placeholder ?? '';
				options = question.options?.length ? [...question.options] : [''];
				min = question.min != null ? String(question.min) : '';
				max = question.max != null ? String(question.max) : '';
				regex = question.regex ?? '';
				linkedField = question.linkedField ?? '';
				optionPreset = question.optionPreset;
			} else {
				title = seed?.title ?? '';
				type = seed?.type ?? 'SHORT_TEXT';
				required = false;
				targetRole = [];
				placeholder = '';
				options = [''];
				min = '';
				max = '';
				regex = '';
				linkedField = '';
				optionPreset = null;
			}
			errors = {};
			newOptionInput = '';
			dismissed = null;
			appliedDefaults = false;
		}
	});

	const isOptions = $derived(type === 'MULTIPLE_CHOICE' || type === 'DROPDOWN');
	// Hidden rather than disabled under a preset: 6,447 read-only inputs is not a form.
	const showOptions = $derived(isOptions && optionPreset === null);
	const showPreset = $derived(isOptions && optionPreset !== null);
	const showMinMax = $derived(type === 'NUMBER');
	const showPlaceholder = $derived(type !== 'CHECKBOX' && type !== 'MULTIPLE_CHOICE');

	// Advisory only: every field stays reachable from the select.
	const suggestion = $derived(linkedField === '' ? (suggestLinkedField(title) ?? null) : null);
	const showSuggestion = $derived(suggestion !== null && suggestion !== dismissed);

	// Applies the field's default shape on every change, including back to None, so
	// switching University to Year does not leave the university preset behind.
	function setLinkedField(field: LinkedField | '') {
		linkedField = field;
		if (field === '') {
			optionPreset = null;
			appliedDefaults = false;
			return;
		}
		const defaults = defaultsFor(field);
		type = defaults.type;
		optionPreset = defaults.optionPreset;
		options = defaults.options.length ? defaults.options : [''];
		appliedDefaults = true;
	}

	function acceptSuggestion() {
		if (suggestion) setLinkedField(suggestion);
	}

	function toggleRole(role: Role) {
		if (targetRole.includes(role)) {
			targetRole = targetRole.filter((r) => r !== role);
		} else {
			targetRole = [...targetRole, role];
		}
	}

	function addOption() {
		const val = newOptionInput.trim();
		if (val) {
			options = [...options.filter((o) => o.trim()), val];
			newOptionInput = '';
		}
	}

	function removeOption(i: number) {
		options = options.filter((_, idx) => idx !== i);
		if (options.length === 0) options = [''];
	}

	function updateOption(i: number, val: string) {
		options = options.map((o, idx) => (idx === i ? val : o));
	}

	// Each row carries its index into the unfiltered `options`: filtering first and
	// using the loop counter edited the wrong entry whenever a blank sat earlier, and
	// option text is editable so it cannot be the key. A lone blank survives the filter.
	const editableOptions = $derived(
		options
			.map((value, index) => ({ value, index }))
			.filter((o) => o.value.trim() !== '' || options.length === 1)
			.map((o, position) => ({ ...o, position: position + 1 }))
	);

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!title.trim()) errs.title = 'Title is required';
		// A preset already has thousands of options; only a hand-authored list can be short.
		if (showOptions) {
			const filled = options.filter((o) => o.trim());
			if (filled.length < 2) errs.options = 'At least 2 options required';
		}
		if (showMinMax) {
			if (min !== '' && max !== '' && Number(min) > Number(max)) {
				errs.minMax = 'Min must be less than max';
			}
		}
		errors = errs;
		return Object.keys(errs).length === 0;
	}

	function handleSave() {
		if (!validate()) return;

		const data: Partial<Question> = {
			title: title.trim(),
			type,
			required,
			targetRole,
			placeholder: showPlaceholder ? placeholder.trim() || undefined : undefined,
			options: showOptions ? options.filter((o) => o.trim()) : [],
			min: showMinMax && min !== '' ? Number(min) : null,
			max: showMinMax && max !== '' ? Number(max) : null,
			regex: regex.trim() || undefined,
			linkedField: linkedField || null,
			// Cleared for non-choice types so a stale preset cannot return on a later type switch.
			optionPreset: isOptions ? optionPreset : null
		};

		onSave(data);
	}

	function handleBackdropClick(e: MouseEvent) {
		if ((e.target as HTMLElement).classList.contains('modal-backdrop')) onCancel();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown}>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-label={question ? 'Edit Question' : 'Add Question'}
		>
			<div class="modal-header">
				<h2>{question ? 'Edit Question' : 'New Question'}</h2>
				<button class="close-btn" onclick={onCancel} aria-label="Close">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>

			<div class="modal-body">
				<div class="field" class:field-error={errors.title}>
					<label for="q-title">Question Title <span class="req">*</span></label>
					<input
						id="q-title"
						type="text"
						bind:value={title}
						placeholder="e.g. What is your major?"
					/>
					{#if errors.title}<p class="error-msg">{errors.title}</p>{/if}

					{#if showSuggestion && suggestion}
						<div class="suggestion">
							<span class="suggestion-text">
								This looks like a {LINKED_FIELD_LABEL[suggestion]} question.
							</span>
							<button type="button" class="suggestion-accept" onclick={acceptSuggestion}>
								Link to {LINKED_FIELD_LABEL[suggestion]}
							</button>
							<button
								type="button"
								class="suggestion-dismiss"
								onclick={() => (dismissed = suggestion)}
							>
								Dismiss
							</button>
						</div>
					{/if}
				</div>

				<div class="row-2">
					<div class="field">
						<label for="q-type">Type <span class="req">*</span></label>
						<Combobox
							id="q-type"
							options={QUESTION_TYPES}
							value={type}
							onChange={(next) => (type = next as QuestionType)}
							ariaLabel="Question type"
						/>
						{#if appliedDefaults}
							<p class="field-note">Set by the linked field. You can change it.</p>
						{/if}
					</div>
					<div class="field field-inline">
						<label>
							<input type="checkbox" bind:checked={required} />
							<span>Required</span>
						</label>
					</div>
				</div>

				<!-- A group label, not a <label>: there is no single control to point at. -->
				<div class="field">
					<span class="field-label" id="target-roles-label">
						Target Roles <span class="hint">(leave empty for all)</span>
					</span>
					<div class="role-grid" role="group" aria-labelledby="target-roles-label">
						{#each ALL_ROLES as role (role)}
							<button
								type="button"
								class="role-toggle"
								class:active={targetRole.includes(role)}
								onclick={() => toggleRole(role)}
							>
								{role}
							</button>
						{/each}
					</div>
				</div>

				{#if showPlaceholder}
					<div class="field">
						<label for="q-placeholder">Placeholder Text</label>
						<input
							id="q-placeholder"
							type="text"
							bind:value={placeholder}
							placeholder="e.g. Enter your answer..."
						/>
					</div>
				{/if}

				{#if showPreset && optionPreset}
					<div class="field">
						<span class="field-label">Options</span>
						<div class="preset-row">
							<span class="preset-name">{OPTION_PRESET_LABEL[optionPreset]}</span>
							<button type="button" class="preset-clear" onclick={() => (optionPreset = null)}>
								Use my own options
							</button>
						</div>
						<p class="field-note">
							A bundled list, kept up to date in the codebase. Applicants whose answer isn't in it
							can still enter their own.
						</p>
					</div>
				{/if}

				{#if showOptions}
					<div class="field" class:field-error={errors.options}>
						<span class="field-label" id="options-label">
							Options <span class="req">*</span>
						</span>
						<div class="options-list" role="group" aria-labelledby="options-label">
							{#each editableOptions as opt (opt.index)}
								<div class="option-row">
									<span class="opt-bullet">•</span>
									<input
										type="text"
										value={opt.value}
										oninput={(e) => updateOption(opt.index, (e.target as HTMLInputElement).value)}
										placeholder="Option {opt.position}"
									/>
									<button
										type="button"
										class="remove-opt"
										onclick={() => removeOption(opt.index)}
										aria-label="Remove option"
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<line x1="18" y1="6" x2="6" y2="18"></line>
											<line x1="6" y1="6" x2="18" y2="18"></line>
										</svg>
									</button>
								</div>
							{/each}
							<div class="option-add-row">
								<input
									type="text"
									bind:value={newOptionInput}
									placeholder="Add option..."
									onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
								/>
								<button type="button" class="add-opt-btn" onclick={addOption}>Add</button>
							</div>
						</div>
						{#if errors.options}<p class="error-msg">{errors.options}</p>{/if}
					</div>
				{/if}

				{#if showMinMax}
					<div class="row-2" class:field-error={errors.minMax}>
						<div class="field">
							<label for="q-min">Minimum</label>
							<input id="q-min" type="number" bind:value={min} placeholder="e.g. 0" />
						</div>
						<div class="field">
							<label for="q-max">Maximum</label>
							<input id="q-max" type="number" bind:value={max} placeholder="e.g. 100" />
						</div>
					</div>
					{#if errors.minMax}<p class="error-msg" style="margin-top: -8px">{errors.minMax}</p>{/if}
				{/if}

				<div class="row-2">
					<div class="field">
						<label for="q-linked">Linked Field</label>
						<!-- `onChange`, not `bind:value`: attaching a field also applies its defaults. -->
						<Combobox
							id="q-linked"
							options={LINKED_FIELD_CHOICES}
							value={linkedField}
							onChange={(next) => setLinkedField(next as LinkedField | '')}
							ariaLabel="Linked field"
						/>
					</div>
					<div class="field">
						<label for="q-regex">Validation Regex</label>
						<input id="q-regex" type="text" bind:value={regex} placeholder="e.g. ^[a-zA-Z]+$" />
					</div>
				</div>
			</div>

			<div class="modal-footer">
				<button class="btn-cancel" onclick={onCancel}>Cancel</button>
				<button class="btn-save" onclick={handleSave}>
					{question ? 'Save Changes' : 'Add Question'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(25, 25, 25, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
		backdrop-filter: blur(2px);
		padding: 20px;
	}

	.modal {
		background: #fff;
		border-radius: 12px;
		width: 100%;
		max-width: 560px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 24px 16px;
		border-bottom: 1px solid #e0e0e0;
	}

	.modal-header h2 {
		font-size: 16px;
		font-weight: 700;
		color: #191919;
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		background: #f4f4f4;
		color: #666;
		cursor: pointer;
		transition: all 0.12s;
		padding: 0;
	}

	.close-btn:hover {
		background: #191919;
		border-color: #191919;
		color: #fff;
	}

	.modal-body {
		overflow-y: auto;
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.modal-footer {
		padding: 16px 24px;
		border-top: 1px solid #e0e0e0;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label,
	.field .field-label {
		font-size: 12px;
		font-weight: 600;
		color: #444;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.field-inline {
		justify-content: flex-end;
		padding-bottom: 2px;
	}

	.field-inline label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		color: #191919;
	}

	.field-inline input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: #191919;
		cursor: pointer;
	}

	.req {
		color: #b00000;
	}

	.hint {
		font-weight: 400;
		color: #aaa;
		font-size: 11px;
	}

	input[type='text'],
	input[type='number'] {
		padding: 8px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		font-size: 13px;
		color: #191919;
		background: #fff;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
		outline: none;
		width: 100%;
		box-sizing: border-box;
	}

	input:focus {
		border-color: #191919;
		box-shadow: 0 0 0 2px rgba(25, 25, 25, 0.08);
	}

	.row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		align-items: end;
	}

	.role-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.role-toggle {
		font-size: 11px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 5px;
		border: 1px solid #e0e0e0;
		background: #f4f4f4;
		color: #666;
		cursor: pointer;
		transition: all 0.12s;
		letter-spacing: 0.02em;
	}

	.role-toggle.active {
		background: #191919;
		border-color: #191919;
		color: #fff;
	}

	.role-toggle:hover:not(.active) {
		border-color: #aaa;
		color: #333;
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.option-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.opt-bullet {
		color: #aaa;
		font-size: 16px;
		line-height: 1;
		padding-bottom: 1px;
	}

	.option-row input {
		flex: 1;
	}

	.remove-opt {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: none;
		color: #ccc;
		cursor: pointer;
		padding: 0;
		border-radius: 4px;
		transition: all 0.12s;
		flex-shrink: 0;
	}

	.remove-opt:hover {
		color: #b00000;
		background: #b0000010;
	}

	.option-add-row {
		display: flex;
		gap: 6px;
	}

	.option-add-row input {
		flex: 1;
		font-style: italic;
		color: #888;
	}

	.add-opt-btn {
		font-size: 12px;
		font-weight: 600;
		padding: 8px 14px;
		background: #f4f4f4;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		cursor: pointer;
		color: #444;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.add-opt-btn:hover {
		background: #191919;
		border-color: #191919;
		color: #fff;
	}

	/* Scoped CSS rather than design tokens: this file predates the design system and
	   porting it is a separate job. */
	.suggestion {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 2px;
		padding: 7px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		background: #f4f4f4;
	}

	.suggestion-text {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: #444;
	}

	.suggestion-accept,
	.suggestion-dismiss {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 5px;
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.suggestion-accept {
		border: 1px solid #191919;
		background: #191919;
		color: #fff;
	}

	.suggestion-accept:hover {
		background: #333;
		border-color: #333;
	}

	.suggestion-dismiss {
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #666;
	}

	.suggestion-dismiss:hover {
		border-color: #aaa;
		color: #191919;
	}

	.preset-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		background: #f4f4f4;
	}

	.preset-name {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: #191919;
	}

	.preset-clear {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 9px;
		border: 1px solid #e0e0e0;
		border-radius: 5px;
		background: #fff;
		color: #666;
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.preset-clear:hover {
		border-color: #aaa;
		color: #191919;
	}

	.field-note {
		font-size: 11px;
		color: #888;
		margin: 0;
	}

	.field-error input {
		border-color: #b00000;
	}

	.error-msg {
		font-size: 11px;
		color: #b00000;
		margin: 0;
	}

	.btn-cancel {
		font-size: 13px;
		font-weight: 500;
		padding: 8px 16px;
		border: 1px solid #e0e0e0;
		border-radius: 7px;
		background: #f4f4f4;
		color: #444;
		cursor: pointer;
		transition: all 0.12s;
	}

	.btn-cancel:hover {
		border-color: #aaa;
		color: #191919;
	}

	.btn-save {
		font-size: 13px;
		font-weight: 600;
		padding: 8px 18px;
		border: 1px solid #191919;
		border-radius: 7px;
		background: #191919;
		color: #fff;
		cursor: pointer;
		transition: all 0.12s;
	}

	.btn-save:hover {
		background: #333;
		border-color: #333;
	}
</style>
