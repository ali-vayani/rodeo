<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { PageData, ActionData } from './$types';
  import QuestionListItem from '$lib/components/admin/applications/QuestionListItem.svelte';
  import QuestionEditor from '$lib/components/admin/applications/QuestionEditor.svelte';
  import PreviewPane from '$lib/components/admin/applications/PreviewPane.svelte';
  import ConfirmationModal from '$lib/components/admin/applications/ConfirmationModal.svelte';

  import type { QuestionType, Question, Role } from '$lib/generated/prisma/client';

  interface Props {
    data: PageData;
    form: ActionData;
  }

  let { data, form }: Props = $props();

  // Seed working copy from server data; re-seed when data changes (after invalidation)
  let questions = $derived<Question[]>(data.questions as Question[]);
  let workingQuestions = $derived<Question[]>(
    data.questions.map(q => ({ ...q, options: [...(q.options ?? [])], targetRole: [...(q.targetRole ?? [])] })) as Question[]
  );

  $effect(() => {
    questions = data.questions as Question[];
    workingQuestions = data.questions.map(q => ({
      ...q,
      options: [...(q.options ?? [])],
      targetRole: [...(q.targetRole ?? [])],
    })) as Question[];
  });

  let isSaving = $state(false);

  // Modal states
  let editorOpen = $state(false);
  let editingQuestion = $state<Question | null>(null);
  let confirmOpen = $state(false);

  // Add question form
  let addTitle = $state('');
  let addType = $state<QuestionType>('SHORT_TEXT');

  // Toast
  let toastMsg = $state('');
  let toastKind = $state<'success' | 'error'>('success');
  let toastTimer: ReturnType<typeof setTimeout>;

  // Show toast when form action returns
  $effect(() => {
    if (form?.error) {
      showToast(form.error, 'error');
    } else if (form?.success) {
      showToast('Changes saved successfully!');
    }
  });

  function showToast(msg: string, kind: 'success' | 'error' = 'success') {
    toastMsg = msg;
    toastKind = kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMsg = ''), 3500);
  }

  const ALL_ROLES: Role[] = ['HACKER', 'JUDGE', 'MENTOR', 'VOLUNTEER', 'ORGANIZER', 'ADMIN', 'UNDECLARED'];
  let selectedRole = $state<Role>('HACKER');

  // Derived: pending changes
  const pendingChanges = $derived.by(() => {
    const added = workingQuestions.filter(q => !q.id || q.id.startsWith('temp-'));
    const deleted = questions.filter(q => !workingQuestions.find(wq => wq.id === q.id));
    const modified = workingQuestions.filter(wq => {
      const original = questions.find(q => q.id === wq.id);
      return original && JSON.stringify(original) !== JSON.stringify(wq);
    });
    // Build reorder payload: only persisted questions whose order index changed
    const reordered = workingQuestions
      .filter(q => q.id && !q.id.startsWith('temp-'))
      .map((q, i) => ({ id: q.id!, order: i }))
      .filter(({ id, order }) => {
        const original = questions.find(q => q.id === id);
        return original && original.order !== order;
      });

    return { added, modified, deleted, reordered };
  });

  const filteredQuestions = $derived(
    workingQuestions.filter(q =>
      q.targetRole.length === 0 || q.targetRole.includes(selectedRole)
    )
  );

  const isDirty = $derived(
    pendingChanges.added.length > 0 ||
    pendingChanges.modified.length > 0 ||
    pendingChanges.deleted.length > 0 ||
    pendingChanges.reordered.length > 0
  );

  // Unsaved-changes guard
  $effect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // Reorder
  function moveUp(index: number) {
    if (index === 0) return;
    const arr = [...workingQuestions];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    workingQuestions = arr.map((q, i) => ({ ...q, order: i }));
  }

  function moveDown(index: number) {
    if (index === workingQuestions.length - 1) return;
    const arr = [...workingQuestions];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    workingQuestions = arr.map((q, i) => ({ ...q, order: i }));
  }

  // Edit
  function openEdit(q: Question) {
    editingQuestion = { ...q, options: [...(q.options ?? [])], targetRole: [...(q.targetRole ?? [])] };
    editorOpen = true;
  }

  function handleEditorSave(partial: Partial<Question>) {
    if (editingQuestion?.id) {
      workingQuestions = workingQuestions.map(q =>
        q.id === editingQuestion!.id ? { ...q, ...partial } : q
      );
    } else {
      const tempId = `temp-${Date.now()}`;
      workingQuestions = [
        ...workingQuestions,
        { id: tempId, order: workingQuestions.length, required: false, targetRole: [], options: [], ...partial } as Question,
      ];
    }
    editorOpen = false;
    editingQuestion = null;
  }

  // Delete
  function deleteQuestion(id: string | undefined) {
    if (!id) return;
    workingQuestions = workingQuestions.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i }));
  }

  // Quick-add form
  function handleQuickAdd() {
    if (!addTitle.trim()) return;
    const tempId = `temp-${Date.now()}`;
    workingQuestions = [
      ...workingQuestions,
      {
        id: tempId,
        title: addTitle.trim(),
        type: addType,
        order: workingQuestions.length,
        required: false,
        targetRole: [],
        placeholder: null,
        options: [],
        min: null,
        max: null,
        regex: null,
        linkedField: null,
      } as Question,
    ];
    addTitle = '';
    addType = 'SHORT_TEXT';
  }

  // Save flow
  function handleSaveClick() {
    if (!isDirty) return;
    confirmOpen = true;
  }

  // The hidden input value sent to the form action
  const changesPayload = $derived(
    JSON.stringify({
      added: pendingChanges.added.map(({ id, ...rest }) => rest),
      modified: pendingChanges.modified,
      deleted: pendingChanges.deleted.map(q => ({ id: q.id })),
      reordered: pendingChanges.reordered,
    })
  );

  const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
    { value: 'SHORT_TEXT', label: 'Short Text' },
    { value: 'LONG_TEXT', label: 'Long Text' },
    { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
    { value: 'DROPDOWN', label: 'Dropdown' },
    { value: 'NUMBER', label: 'Number' },
    { value: 'CHECKBOX', label: 'Checkbox' },
  ];
</script>

<div class="page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-top">
      <div class="header-left">
        <h1>Applications</h1>
        {#if isDirty}
          <span class="unsaved-badge">Unsaved changes</span>
        {/if}
      </div>
      <button class="btn-save" onclick={handleSaveClick} disabled={!isDirty || isSaving}>
        {#if isSaving}
          <span class="spinner-sm"></span>
          Saving…
        {:else}
          Save Changes
        {/if}
      </button>
    </div>
    <div class="header-bottom">
      <div class="role-selector">
        <label for="role-select">Role:</label>
        <select id="role-select" bind:value={selectedRole}>
          {#each ALL_ROLES as role}
            <option value={role}>{role}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <div class="content-grid">
    <!-- Left: Question List -->
    <div class="question-list-col">
      <div class="col-header">
        <span class="col-label">Questions</span>
        <span class="count-badge">{filteredQuestions.length}</span>
      </div>

      <div class="question-list">
        {#if workingQuestions.length === 0}
          <div class="list-empty">
            <p>No questions yet. Add one below.</p>
          </div>
        {:else}
          {#each filteredQuestions as q, i (q.id)}
            <QuestionListItem
              question={q}
              index={i}
              canMoveUp={i > 0}
              canMoveDown={i < filteredQuestions.length - 1}
              onEdit={() => openEdit(q)}
              onDelete={() => deleteQuestion(q.id)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
            />
          {/each}
        {/if}
      </div>

      <!-- Add Question Form -->
      <div class="add-form">
        <div class="add-form-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Question
        </div>
        <div class="add-form-body">
          <input
            type="text"
            bind:value={addTitle}
            placeholder="Question title…"
            onkeydown={(e) => e.key === 'Enter' && handleQuickAdd()}
            class="add-title-input"
          />
          <div class="add-row">
            <select bind:value={addType} class="add-type-select">
              {#each QUESTION_TYPES as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
            <button class="btn-add-q" onclick={handleQuickAdd} disabled={!addTitle.trim()}>
              Add
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Preview -->
    <div class="preview-col">
      <PreviewPane questions={workingQuestions} {selectedRole} />
    </div>
  </div>
</div>

<!-- Hidden form for the save action — submitted programmatically from ConfirmationModal -->
<form
  method="POST"
  action="?/save"
  use:enhance={() => {
    isSaving = true;
    return async ({ result, update }) => {
      isSaving = false;
      confirmOpen = false;
      if (result.type === 'success') {
        await invalidateAll();
      }
      await update({ reset: false });
    };
  }}
  id="save-form"
  style="display:none"
>
  <input type="hidden" name="changes" value={changesPayload} />
</form>

<!-- Modals -->
<QuestionEditor
  question={editingQuestion}
  isOpen={editorOpen}
  onSave={handleEditorSave}
  onCancel={() => { editorOpen = false; editingQuestion = null; }}
/>

<ConfirmationModal
  isOpen={confirmOpen}
  changes={{
    added: pendingChanges.added,
    modified: pendingChanges.modified,
    deleted: pendingChanges.deleted,
    reordered: pendingChanges.reordered.length > 0,
  }}
  {isSaving}
  onConfirm={() => {
    (document.getElementById('save-form') as HTMLFormElement)?.requestSubmit();
  }}
  onCancel={() => (confirmOpen = false)}
/>

<!-- Toast -->
{#if toastMsg}
  <div class="toast" class:toast-error={toastKind === 'error'}>
    {#if toastKind === 'success'}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    {/if}
    {toastMsg}
  </div>
{/if}

<style>
  .page {
    padding: 28px 32px;
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 100vh;
  }

  .page-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-bottom {
    display: flex;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h1 {
    font-size: 22px;
    font-weight: 800;
    color: #191919;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .unsaved-badge {
    font-size: 11px;
    font-weight: 600;
    color: #b45309;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 5px;
    padding: 3px 8px;
    letter-spacing: 0.01em;
  }

  .btn-save {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 20px;
    background: #191919;
    border: 1px solid #191919;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    transition: background 0.12s;
  }

  .btn-save:hover:not(:disabled) {
    background: #333;
    border-color: #333;
  }

  .btn-save:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.role-selector {
  display: flex;
  align-items: center;
  gap: 6px;
}

.role-selector label {
  font-size: 12px;
  font-weight: 500;
  color: #888;
}

.role-selector select {
  font-size: 12px;
  font-weight: 600;
  color: #191919;
  background: #f4f4f4;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
}

.role-selector select:focus {
  border-color: #191919;
}

  .spinner-sm {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 60% 1fr;
    gap: 20px;
    align-items: start;
  }

  .question-list-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .col-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 2px;
  }

  .col-label {
    font-size: 11px;
    font-weight: 700;
    color: #aaa;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 700;
    color: #888;
    background: #f4f4f4;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 1px 7px;
  }

  .question-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list-empty {
    padding: 32px;
    text-align: center;
    border: 1px dashed #e0e0e0;
    border-radius: 8px;
  }

  .list-empty p {
    font-size: 13px;
    color: #aaa;
    margin: 0;
  }

  .add-form {
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
    margin-top: 4px;
  }

  .add-form-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    background: #f4f4f4;
    border-bottom: 1px solid #e0e0e0;
    font-size: 12px;
    font-weight: 700;
    color: #444;
    letter-spacing: 0.01em;
  }

  .add-form-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .add-title-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 13px;
    color: #191919;
    background: #fff;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, box-shadow 0.12s;
  }

  .add-title-input:focus {
    border-color: #191919;
    box-shadow: 0 0 0 2px rgba(25,25,25,0.07);
  }

  .add-row {
    display: flex;
    gap: 8px;
  }

  .add-type-select {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 13px;
    color: #191919;
    background: #fff;
    outline: none;
    transition: border-color 0.12s;
  }

  .add-type-select:focus {
    border-color: #191919;
  }

  .btn-add-q {
    font-size: 13px;
    font-weight: 600;
    padding: 8px 20px;
    background: #191919;
    border: 1px solid #191919;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }

  .btn-add-q:hover:not(:disabled) {
    background: #333;
  }

  .btn-add-q:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .preview-col {
    position: sticky;
    top: 20px;
    height: calc(100vh - 120px);
  }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    background: #191919;
    color: #fff;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 100;
    animation: slideUp 0.2s ease;
  }

  .toast-error {
    background: #b00000;
  }

  @keyframes slideUp {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
    .preview-col {
      position: static;
      height: 400px;
    }
  }
</style>