<script lang="ts">
	import type { Role, Question } from '$lib/generated/prisma/client';
	import { OPTION_PRESET_LABEL } from '$lib/questions/options';

	interface Props {
		questions: Question[];
		selectedRole: Role;
	}

	let { questions, selectedRole }: Props = $props();

	const visibleQuestions = $derived(
		questions.filter((q) => q.targetRole.length === 0 || q.targetRole.includes(selectedRole))
	);
</script>

<div class="preview-pane">
	<div class="pane-header">
		<span class="pane-title">Preview</span>
	</div>

	<div class="pane-body">
		{#if visibleQuestions.length === 0}
			<div class="empty-state">
				<svg
					width="36"
					height="36"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#ccc"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<line x1="3" y1="9" x2="21" y2="9"></line>
					<line x1="9" y1="21" x2="9" y2="9"></line>
				</svg>
				<p>No questions visible for {selectedRole}</p>
			</div>
		{:else}
			<div class="form-preview">
				{#each visibleQuestions as q, i (q.id)}
					<div class="preview-field">
						<span class="preview-label">
							{q.title}
							{#if q.required}<span class="req">*</span>{/if}
						</span>

						{#if q.type === 'SHORT_TEXT'}
							<input type="text" placeholder={q.placeholder || 'Your answer'} disabled />
						{:else if q.type === 'LONG_TEXT'}
							<textarea placeholder={q.placeholder || 'Your answer'} rows={3} disabled></textarea>
						{:else if q.type === 'NUMBER'}
							<input
								type="number"
								placeholder={q.placeholder || '0'}
								min={q.min ?? undefined}
								max={q.max ?? undefined}
								disabled
							/>
							{#if q.min != null || q.max != null}
								<p class="field-hint">
									{#if q.min != null && q.max != null}Between {q.min} and {q.max}{/if}
									{#if q.min != null && q.max == null}Minimum: {q.min}{/if}
									{#if q.min == null && q.max != null}Maximum: {q.max}{/if}
								</p>
							{/if}
						{:else if q.type === 'FILE'}
							<input type="file" disabled />
							<!-- No size stated: the limit lives in a server module, and a copy here would drift. -->
							<p class="field-hint">Applicants upload one file</p>
						{:else if q.type === 'CHECKBOX'}
							<label class="checkbox-label">
								<input type="checkbox" disabled />
								<span>{q.placeholder || q.title}</span>
							</label>
						{:else if q.type === 'DROPDOWN'}
							<!-- A disabled text box, not a `Combobox`: a listbox that cannot open says
							     less than one line naming the source and count of the options. -->
							<input type="text" placeholder={q.placeholder || 'Search…'} disabled />
							<p class="field-hint">
								{#if q.optionPreset}
									{OPTION_PRESET_LABEL[q.optionPreset]} · answers outside the list are accepted
								{:else if q.options.length > 0}
									Searchable · {q.options.length} option{q.options.length === 1 ? '' : 's'}
									{#if q.allowOther}· write-ins accepted{/if}
								{:else}
									No options defined yet
								{/if}
							</p>
						{:else if q.type === 'MULTI_SELECT'}
							<div class="radio-group">
								{#each q.options as opt (opt)}
									<label class="checkbox-label">
										<input type="checkbox" disabled />
										<span>{opt}</span>
									</label>
								{/each}
								{#if q.allowOther}
									<label class="checkbox-label">
										<input type="checkbox" disabled />
										<span>Other</span>
									</label>
								{/if}
								{#if q.options.length === 0}
									<p class="field-hint no-opts">No options defined yet</p>
								{:else}
									<p class="field-hint">
										Applicants can pick more than one{q.allowOther ? ', or write their own' : ''}
									</p>
								{/if}
							</div>
						{:else if q.type === 'MULTIPLE_CHOICE'}
							<div class="radio-group">
								{#each q.options as opt (opt)}
									<label class="radio-label">
										<input type="radio" name="preview-{q.id || i}" value={opt} disabled />
										<span>{opt}</span>
									</label>
								{/each}
								{#if q.allowOther}
									<label class="radio-label">
										<input type="radio" name="preview-{q.id || i}" disabled />
										<span>Other</span>
									</label>
								{/if}
								{#if q.options.length === 0}
									<p class="field-hint no-opts">No options defined yet</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				<div class="submit-preview">
					<button type="button" disabled>Submit Application</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.preview-pane {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #f4f4f4;
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		overflow: hidden;
	}

	.pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: #fff;
		border-bottom: 1px solid #e0e0e0;
		flex-shrink: 0;
	}

	.pane-title {
		font-size: 12px;
		font-weight: 700;
		color: #aaa;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.pane-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 16px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 200px;
		gap: 12px;
		color: #ccc;
	}

	.empty-state p {
		font-size: 13px;
		color: #bbb;
		margin: 0;
		text-align: center;
	}

	.form-preview {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.preview-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.preview-label {
		font-size: 13px;
		font-weight: 600;
		color: #191919;
		line-height: 1.3;
	}

	.req {
		color: #b00000;
		margin-left: 2px;
	}

	input[type='text'],
	input[type='number'],
	textarea {
		padding: 8px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		font-size: 13px;
		color: #999;
		background: #fff;
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		font-family: inherit;
	}

	input:disabled,
	textarea:disabled {
		background: #fafafa;
		cursor: not-allowed;
		color: #bbb;
	}

	.field-hint {
		font-size: 11px;
		color: #aaa;
		margin: 0;
	}

	.no-opts {
		font-style: italic;
		color: #ccc;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #555;
		cursor: not-allowed;
	}

	.checkbox-label input {
		width: 15px;
		height: 15px;
		accent-color: #191919;
		padding: 0;
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.radio-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #555;
		cursor: not-allowed;
	}

	.radio-label input {
		width: 15px;
		height: 15px;
		padding: 0;
	}

	.submit-preview {
		margin-top: 8px;
		padding-top: 16px;
		border-top: 1px solid #e0e0e0;
	}

	.submit-preview button {
		font-size: 13px;
		font-weight: 600;
		padding: 9px 20px;
		background: #191919;
		border: none;
		border-radius: 7px;
		color: #fff;
		cursor: not-allowed;
		opacity: 0.4;
	}
</style>
