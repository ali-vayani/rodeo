<script lang="ts">
  import { onMount } from 'svelte';
  import type { Question, QuestionType, Role } from '$lib/generated/prisma/client';

  interface Props {
    question: Question | null;
    isOpen: boolean;
    onSave: (question: Partial<Question>) => void;
    onCancel: () => void;
  }

  let { question, isOpen, onSave, onCancel }: Props = $props();

  const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
    { value: 'SHORT_TEXT', label: 'Short Text' },
    { value: 'LONG_TEXT', label: 'Long Text' },
    { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
    { value: 'DROPDOWN', label: 'Dropdown' },
    { value: 'NUMBER', label: 'Number' },
    { value: 'CHECKBOX', label: 'Checkbox' },
  ];

  const ALL_ROLES: Role[] = ['HACKER', 'JUDGE', 'MENTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN', 'UNDECLARED'];

  const LINKED_FIELDS = [
    { value: '', label: 'None' },
    { value: 'name', label: 'Name' },
    { value: 'university', label: 'University' },
    { value: 'year', label: 'Year' },
  ];

  // Form state
  let title = $state('');
  let type = $state<QuestionType>('SHORT_TEXT');
  let required = $state(false);
  let targetRole = $state<Role[]>([]);
  let placeholder = $state('');
  let options = $state<string[]>(['']);
  let min = $state<string>('');
  let max = $state<string>('');
  let regex = $state('');
  let linkedField = $state('');
  let errors = $state<Record<string, string>>({});
  let newOptionInput = $state('');

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
      } else {
        title = '';
        type = 'SHORT_TEXT';
        required = false;
        targetRole = [];
        placeholder = '';
        options = [''];
        min = '';
        max = '';
        regex = '';
        linkedField = '';
      }
      errors = {};
      newOptionInput = '';
    }
  });

  const showOptions = $derived(type === 'MULTIPLE_CHOICE' || type === 'DROPDOWN');
  const showMinMax = $derived(type === 'NUMBER');
  const showPlaceholder = $derived(type !== 'CHECKBOX' && type !== 'MULTIPLE_CHOICE');

  function toggleRole(role: Role) {
    if (targetRole.includes(role)) {
      targetRole = targetRole.filter(r => r !== role);
    } else {
      targetRole = [...targetRole, role];
    }
  }

  function addOption() {
    const val = newOptionInput.trim();
    if (val) {
      options = [...options.filter(o => o.trim()), val];
      newOptionInput = '';
    }
  }

  function removeOption(i: number) {
    options = options.filter((_, idx) => idx !== i);
    if (options.length === 0) options = [''];
  }

  function updateOption(i: number, val: string) {
    options = options.map((o, idx) => idx === i ? val : o);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required';
    if (showOptions) {
      const filled = options.filter(o => o.trim());
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
      options: showOptions ? options.filter(o => o.trim()) : [],
      min: showMinMax && min !== '' ? Number(min) : null,
      max: showMinMax && max !== '' ? Number(max) : null,
      regex: regex.trim() || undefined,
      linkedField: linkedField || null,
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
    <div class="modal" role="dialog" aria-modal="true" aria-label={question ? 'Edit Question' : 'Add Question'}>
      <div class="modal-header">
        <h2>{question ? 'Edit Question' : 'New Question'}</h2>
        <button class="close-btn" onclick={onCancel} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Title -->
        <div class="field" class:field-error={errors.title}>
          <label for="q-title">Question Title <span class="req">*</span></label>
          <input id="q-title" type="text" bind:value={title} placeholder="e.g. What is your major?" />
          {#if errors.title}<p class="error-msg">{errors.title}</p>{/if}
        </div>

        <!-- Type + Required row -->
        <div class="row-2">
          <div class="field">
            <label for="q-type">Type <span class="req">*</span></label>
            <select id="q-type" bind:value={type}>
              {#each QUESTION_TYPES as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
          </div>
          <div class="field field-inline">
            <label>
              <input type="checkbox" bind:checked={required} />
              <span>Required</span>
            </label>
          </div>
        </div>

        <!-- Target Roles -->
        <div class="field">
          <label>Target Roles <span class="hint">(leave empty for all)</span></label>
          <div class="role-grid">
            {#each ALL_ROLES as role}
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

        <!-- Conditional: Placeholder -->
        {#if showPlaceholder}
          <div class="field">
            <label for="q-placeholder">Placeholder Text</label>
            <input id="q-placeholder" type="text" bind:value={placeholder} placeholder="e.g. Enter your answer..." />
          </div>
        {/if}

        <!-- Conditional: Options -->
        {#if showOptions}
          <div class="field" class:field-error={errors.options}>
            <label>Options <span class="req">*</span></label>
            <div class="options-list">
              {#each options.filter(o => o.trim() !== '' || options.length === 1) as opt, i}
                <div class="option-row">
                  <span class="opt-bullet">•</span>
                  <input
                    type="text"
                    value={opt}
                    oninput={(e) => updateOption(i, (e.target as HTMLInputElement).value)}
                    placeholder="Option {i + 1}"
                  />
                  <button type="button" class="remove-opt" onclick={() => removeOption(i)} aria-label="Remove option">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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

        <!-- Conditional: Min/Max -->
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

        <!-- Linked Field -->
        <div class="row-2">
          <div class="field">
            <label for="q-linked">Linked Field</label>
            <select id="q-linked" bind:value={linkedField}>
              {#each LINKED_FIELDS as lf}
                <option value={lf.value}>{lf.label}</option>
              {/each}
            </select>
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
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
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

  .field label {
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

  .field-inline input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #191919;
    cursor: pointer;
  }

  .req { color: #b00000; }

  .hint {
    font-weight: 400;
    color: #aaa;
    font-size: 11px;
  }

  input[type="text"],
  input[type="number"],
  select {
    padding: 8px 10px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 13px;
    color: #191919;
    background: #fff;
    transition: border-color 0.12s, box-shadow 0.12s;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  input:focus, select:focus {
    border-color: #191919;
    box-shadow: 0 0 0 2px rgba(25,25,25,0.08);
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

  .field-error input,
  .field-error select {
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