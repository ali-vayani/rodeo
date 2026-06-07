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

  let editorOpen = $state(false);
  let editingQuestion = $state<Question | null>(null);
  let confirmOpen = $state(false);

  let addTitle = $state('');
  let addType = $state<QuestionType>('SHORT_TEXT');

  let toastMsg = $state('');
  let toastKind = $state<'success' | 'error'>('success');
  let toastTimer: ReturnType<typeof setTimeout>;

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

  const pendingChanges = $derived.by(() => {
    const added = workingQuestions.filter(q => !q.id || q.id.startsWith('temp-'));
    const deleted = questions.filter(q => !workingQuestions.find(wq => wq.id === q.id));
    const modified = workingQuestions.filter(wq => {
      const original = questions.find(q => q.id === wq.id);
      return original && JSON.stringify(original) !== JSON.stringify(wq);
    });
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

  function deleteQuestion(id: string | undefined) {
    if (!id) return;
    workingQuestions = workingQuestions.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i }));
  }

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

  function handleSaveClick() {
    if (!isDirty) return;
    confirmOpen = true;
  }

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

<!-- Page -->
<div class="px-8 py-7 max-w-[1200px] mx-auto flex flex-col gap-5 min-h-screen">

  <!-- Header -->
  <div class="flex flex-col gap-2.5">
    <!-- Top row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-[22px] font-extrabold text-[#191919] m-0 tracking-tight">Applications</h1>
        {#if isDirty}
          <span class="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-[5px] px-2 py-0.5 tracking-[0.01em]">
            Unsaved changes
          </span>
        {/if}
      </div>
      <button
        class="flex items-center gap-2 text-[13px] font-semibold px-5 py-[9px] bg-[#191919] border border-[#191919] rounded-lg text-white cursor-pointer transition-colors duration-[120ms] hover:bg-[#333] hover:border-[#333] disabled:opacity-35 disabled:cursor-not-allowed"
        onclick={handleSaveClick}
        disabled={!isDirty || isSaving}
      >
        {#if isSaving}
          <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          Saving…
        {:else}
          Save Changes
        {/if}
      </button>
    </div>
    <!-- Bottom row -->
    <div class="flex items-center">
      <div class="flex items-center gap-1.5">
        <label for="role-select" class="text-xs font-medium text-[#888]">Role:</label>
        <select
          id="role-select"
          bind:value={selectedRole}
          class="text-xs font-semibold text-[#191919] bg-[#f4f4f4] border border-[#e0e0e0] rounded-[5px] px-2 py-1 cursor-pointer outline-none focus:border-[#191919]"
        >
          {#each ALL_ROLES as role}
            <option value={role}>{role}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <!-- Content grid -->
  <div class="grid grid-cols-[60%_1fr] gap-5 items-start max-[900px]:grid-cols-1">

    <!-- Left: Question list -->
    <div class="flex flex-col gap-2.5">
      <!-- Col header -->
      <div class="flex items-center gap-2 px-0.5">
        <span class="text-[11px] font-bold text-[#aaa] tracking-[0.08em] uppercase">Questions</span>
        <span class="text-[11px] font-bold text-[#888] bg-[#f4f4f4] border border-[#e0e0e0] rounded-xl px-[7px] py-px">
          {filteredQuestions.length}
        </span>
      </div>

      <!-- List -->
      <div class="flex flex-col gap-1.5">
        {#if workingQuestions.length === 0}
          <div class="p-8 text-center border border-dashed border-[#e0e0e0] rounded-lg">
            <p class="text-[13px] text-[#aaa] m-0">No questions yet. Add one below.</p>
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

      <!-- Add question form -->
      <div class="border border-[#e0e0e0] rounded-[10px] overflow-hidden bg-white mt-1">
        <div class="flex items-center gap-[7px] px-3.5 py-2.5 bg-[#f4f4f4] border-b border-[#e0e0e0] text-xs font-bold text-[#444] tracking-[0.01em]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Question
        </div>
        <div class="p-3.5 flex flex-col gap-2">
          <input
            type="text"
            bind:value={addTitle}
            placeholder="Question title…"
            onkeydown={(e) => e.key === 'Enter' && handleQuickAdd()}
            class="w-full px-2.5 py-2 border border-[#e0e0e0] rounded-md text-[13px] text-[#191919] bg-white outline-none box-border transition-[border-color,box-shadow] duration-[120ms] focus:border-[#191919] focus:shadow-[0_0_0_2px_rgba(25,25,25,0.07)]"
          />
          <div class="flex gap-2">
            <select
              bind:value={addType}
              class="flex-1 px-2.5 py-2 border border-[#e0e0e0] rounded-md text-[13px] text-[#191919] bg-white outline-none transition-[border-color] duration-[120ms] focus:border-[#191919]"
            >
              {#each QUESTION_TYPES as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
            <button
              class="text-[13px] font-semibold px-5 py-2 bg-[#191919] border border-[#191919] rounded-md text-white cursor-pointer transition-colors duration-[120ms] whitespace-nowrap hover:bg-[#333] disabled:opacity-35 disabled:cursor-not-allowed"
              onclick={handleQuickAdd}
              disabled={!addTitle.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Preview -->
    <div class="sticky top-5 h-[calc(100vh-120px)] max-[900px]:static max-[900px]:h-[400px]">
      <PreviewPane questions={workingQuestions} {selectedRole} />
    </div>
  </div>
</div>

<!-- Hidden save form -->
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
  class="hidden"
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
  <div
    class="fixed bottom-6 right-6 flex items-center gap-2 px-[18px] py-3 rounded-[9px] text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)] z-[100] animate-[slideUp_0.2s_ease]"
    class:bg-[#191919]={toastKind === 'success'}
    class:bg-[#b00000]={toastKind === 'error'}
  >
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
  @keyframes slideUp {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>