<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import QuestionListItem from '$lib/components/admin/applications/QuestionListItem.svelte';
	import QuestionEditor from '$lib/components/admin/applications/QuestionEditor.svelte';
	import PreviewPane from '$lib/components/admin/applications/PreviewPane.svelte';
	import ConfirmationModal from '$lib/components/admin/applications/ConfirmationModal.svelte';
	import { Combobox } from '$lib/components/ui';

	import type { QuestionType, Question, Role } from '$lib/generated/prisma/client';

	interface Props {
		data: PageData;
		form: ActionData;
	}

	let { data, form }: Props = $props();

	let questions = $derived<Question[]>(data.questions as Question[]);
	let workingQuestions = $derived<Question[]>(
		data.questions.map((q) => ({
			...q,
			options: [...(q.options ?? [])],
			targetRole: [...(q.targetRole ?? [])]
		})) as Question[]
	);

	$effect(() => {
		questions = data.questions as Question[];
		workingQuestions = data.questions.map((q) => ({
			...q,
			options: [...(q.options ?? [])],
			targetRole: [...(q.targetRole ?? [])]
		})) as Question[];
	});

	let isSaving = $state(false);

	let editorOpen = $state(false);
	let editingQuestion = $state<Question | null>(null);
	let confirmOpen = $state(false);

	let addTitle = $state('');
	let addType = $state<QuestionType>('SHORT_TEXT');
	/** What the Add Question form was carrying when it opened the editor. */
	let addSeed = $state<{ title: string; type: QuestionType } | null>(null);

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

	const ALL_ROLES: Role[] = [
		'HACKER',
		'JUDGE',
		'MENTOR',
		'VOLUNTEER',
		'ORGANIZER',
		'ADMIN',
		'UNDECLARED'
	];
	let selectedRole = $state<Role>('HACKER');

	const pendingChanges = $derived.by(() => {
		const added = workingQuestions.filter((q) => !q.id || q.id.startsWith('temp-'));
		const deleted = questions.filter((q) => !workingQuestions.find((wq) => wq.id === q.id));
		const modified = workingQuestions.filter((wq) => {
			const original = questions.find((q) => q.id === wq.id);
			return original && JSON.stringify(original) !== JSON.stringify(wq);
		});
		// `order` in the database is sparse — 0,1,2,10,11,12,20,21,… — because it only
		// has to sort, not count. Comparing a stored `order` against its array index
		// therefore flagged most of the list as reordered the moment the page loaded,
		// which is what lit "Unsaved changes" on an untouched page. Compare *sequences*
		// instead: whoever was loaded into slot N versus whoever occupies it now. The
		// values sent to the server stay index-based — that part was always right.
		const persisted = workingQuestions.filter((q) => q.id && !q.id.startsWith('temp-'));
		// Deleting a row closes the gap it left, and that is not a reorder, so the
		// baseline is the loaded sequence with deleted rows taken out of it.
		const loadedSequence = questions
			.filter((q) => persisted.some((p) => p.id === q.id))
			.map((q) => q.id);
		const sequenceChanged = persisted.some((q, i) => loadedSequence[i] !== q.id);
		// When the sequence moves, renumber the whole list rather than only the rows
		// that shifted. Because the stored values are sparse, writing index-based
		// numbers to a subset would let an untouched row's larger legacy value
		// (say 10) sort behind a neighbour that just became 4.
		const reordered = sequenceChanged ? persisted.map((q, i) => ({ id: q.id!, order: i })) : [];

		return { added, modified, deleted, reordered };
	});

	const filteredQuestions = $derived(
		workingQuestions.filter((q) => q.targetRole.length === 0 || q.targetRole.includes(selectedRole))
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

	// ── Reordering ───────────────────────────────────────────────────────────────
	//
	// The list renders `filteredQuestions`, so a row's visible index is NOT its index
	// in `workingQuestions` whenever the Role dropdown hides something. The old
	// index-based moveUp/moveDown indexed straight into `workingQuestions` and so
	// moved the wrong question under any filter. Everything below works by id and
	// resolves positions against the full array.

	let listEl = $state<HTMLDivElement | null>(null);

	type DragState = {
		id: string;
		/** Visible index the row started at. */
		fromIndex: number;
		/** Visible index it will land on if released now. */
		toIndex: number;
		startY: number;
		offset: number;
		/** Row geometry, measured once at pointerdown — nothing reflows mid-drag. */
		rects: { top: number; height: number }[];
		/** Height of the dragged row plus the list gap: how far the rows it passes slide. */
		slot: number;
		minOffset: number;
		maxOffset: number;
	};

	let drag = $state<DragState | null>(null);

	/**
	 * Move `id` so that it takes the slot the visible row at `toIndex` occupies,
	 * rewriting `workingQuestions` — the full array — around it.
	 *
	 * Note what this deliberately does not do: touch `order`. Rewriting `order` on
	 * every row made a one-row move look like eighteen edits. Array position is the
	 * source of truth; `pendingChanges.reordered` derives the numbers at save time.
	 */
	function moveQuestion(id: string, toIndex: number) {
		const visible = filteredQuestions;
		const fromIndex = visible.findIndex((q) => q.id === id);
		if (fromIndex === -1 || toIndex === fromIndex) return;
		if (toIndex < 0 || toIndex >= visible.length) return;

		const anchorId = visible[toIndex].id;
		const arr = [...workingQuestions];
		const from = arr.findIndex((q) => q.id === id);
		if (from === -1) return;
		const [moved] = arr.splice(from, 1);
		const anchor = arr.findIndex((q) => q.id === anchorId);
		if (anchor === -1) return;
		// Past the anchor when moving down, in front of it when moving up.
		arr.splice(toIndex > fromIndex ? anchor + 1 : anchor, 0, moved);
		workingQuestions = arr;
	}

	/** Where the dragged row would land if the pointer were released at `clientY`. */
	function dropIndexFor(state: DragState, clientY: number) {
		let insertion = 0;
		for (const rect of state.rects) {
			if (clientY >= rect.top + rect.height / 2) insertion++;
			else break;
		}
		if (insertion > state.fromIndex) insertion--;
		return Math.max(0, Math.min(state.rects.length - 1, insertion));
	}

	function startDrag(id: string, clientY: number) {
		const rows = listEl ? Array.from(listEl.children) : [];
		const fromIndex = filteredQuestions.findIndex((q) => q.id === id);
		if (fromIndex === -1 || rows.length !== filteredQuestions.length) return;

		const rects = rows.map((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top, height: r.height };
		});
		const first = rects[0];
		const last = rects[rects.length - 1];
		const gap = rects.length > 1 ? rects[1].top - (first.top + first.height) : 0;
		drag = {
			id,
			fromIndex,
			toIndex: fromIndex,
			startY: clientY,
			offset: 0,
			rects,
			slot: rects[fromIndex].height + gap,
			// Keep the floating row inside the list rather than letting it fly away.
			minOffset: first.top - rects[fromIndex].top,
			maxOffset: last.top + last.height - (rects[fromIndex].top + rects[fromIndex].height)
		};
	}

	function updateDrag(clientY: number) {
		if (!drag) return;
		const offset = Math.max(drag.minOffset, Math.min(drag.maxOffset, clientY - drag.startY));
		drag = { ...drag, offset, toIndex: dropIndexFor(drag, clientY) };
	}

	function endDrag(cancelled: boolean) {
		if (!drag) return;
		const { id, toIndex } = drag;
		drag = null;
		if (!cancelled) moveQuestion(id, toIndex);
	}

	/**
	 * How far the visible row at `index` should slide while a drag is in flight.
	 *
	 * The dragged row follows the pointer; every row it has passed slides one slot the
	 * other way, which opens the gap it will drop into. Nothing moves in the DOM until
	 * the pointer is released, so the geometry measured at pointerdown stays valid.
	 */
	function dragOffsetFor(index: number) {
		if (!drag) return 0;
		const { fromIndex, toIndex, slot, offset } = drag;
		if (index === fromIndex) return offset;
		// Everything the row has passed slides by the *dragged* row's height — the size
		// of the hole it left. Shifting by each row's own height instead would leave
		// overlaps wherever two rows differ in height (they do: role chips wrap).
		if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -slot;
		if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return slot;
		return 0;
	}

	/** ArrowUp/ArrowDown on a focused handle — the keyboard path to reordering. */
	function moveByKeyboard(id: string, delta: -1 | 1) {
		const fromIndex = filteredQuestions.findIndex((q) => q.id === id);
		if (fromIndex === -1) return;
		moveQuestion(id, fromIndex + delta);
	}

	$effect(() => {
		if (!drag) return;
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') endDrag(true);
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	function openEdit(q: Question) {
		editingQuestion = {
			...q,
			options: [...(q.options ?? [])],
			targetRole: [...(q.targetRole ?? [])]
		};
		addSeed = null;
		editorOpen = true;
	}

	function handleEditorSave(partial: Partial<Question>) {
		if (editingQuestion?.id) {
			workingQuestions = workingQuestions.map((q) =>
				q.id === editingQuestion!.id ? { ...q, ...partial } : q
			);
		} else {
			const tempId = `temp-${Date.now()}`;
			workingQuestions = [
				...workingQuestions,
				{
					id: tempId,
					order: workingQuestions.length,
					required: false,
					targetRole: [],
					options: [],
					...partial
				} as Question
			];
			// Only now — a cancelled add should leave what was typed in place.
			addTitle = '';
			addType = 'SHORT_TEXT';
		}
		editorOpen = false;
		editingQuestion = null;
		addSeed = null;
	}

	function deleteQuestion(id: string | undefined) {
		if (!id) return;
		// No `order` rewrite here either: renumbering the survivors made every
		// remaining row look edited. `order` only has to sort, and removing one row
		// leaves the rest in the same relative sequence.
		workingQuestions = workingQuestions.filter((q) => q.id !== id);
	}

	/**
	 * Hand the typed title and type to the editor rather than adding straight to
	 * the list.
	 *
	 * This form used to append the question itself, which meant a Dropdown arrived
	 * with zero options and the only way to give it any was to add it, find the row,
	 * and press Edit. The editor already reveals options, placeholder and linked
	 * field the moment a type is chosen — it just wasn't on the path anyone took to
	 * create a question. Routing through it also means new questions face the same
	 * validation as edited ones, so "Dropdown with no options" stops being reachable.
	 */
	function handleQuickAdd() {
		if (!addTitle.trim()) return;
		addSeed = { title: addTitle.trim(), type: addType };
		editingQuestion = null;
		editorOpen = true;
	}

	function handleSaveClick() {
		if (!isDirty) return;
		confirmOpen = true;
	}

	const changesPayload = $derived(
		JSON.stringify({
			added: pendingChanges.added.map(({ id, ...rest }) => rest),
			modified: pendingChanges.modified,
			deleted: pendingChanges.deleted.map((q) => ({ id: q.id })),
			reordered: pendingChanges.reordered
		})
	);

	const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
		{ value: 'SHORT_TEXT', label: 'Short Text' },
		{ value: 'LONG_TEXT', label: 'Long Text' },
		{ value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
		{ value: 'DROPDOWN', label: 'Dropdown' },
		{ value: 'NUMBER', label: 'Number' },
		{ value: 'CHECKBOX', label: 'Checkbox' }
	];
</script>

<!-- Page -->
<div class="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-5 py-2 md:px-8 md:py-7">
	<!-- Header -->
	<div class="flex flex-col gap-2.5">
		<!-- Top row -->
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<div class="flex items-center gap-3">
				<h1 class="m-0 text-[22px] font-extrabold tracking-tight text-[#191919]">Applications</h1>
				{#if isDirty}
					<span
						class="rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tracking-[0.01em] text-amber-700"
					>
						Unsaved changes
					</span>
				{/if}
			</div>
			<button
				class="flex cursor-pointer items-center gap-2 rounded-lg border border-[#191919] bg-[#191919] px-5 py-[9px] text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:border-[#333] hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35"
				onclick={handleSaveClick}
				disabled={!isDirty || isSaving}
			>
				{#if isSaving}
					<span
						class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
					></span>
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
				<Combobox
					id="role-select"
					options={ALL_ROLES.map((r) => ({ value: r, label: r }))}
					value={selectedRole}
					onChange={(next) => (selectedRole = next as Role)}
					ariaLabel="Preview as role"
					class="w-40"
				/>
			</div>
		</div>
	</div>

	<!-- Content grid -->
	<div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[60%_1fr]">
		<!-- Left: Question list -->
		<div class="flex flex-col gap-2.5">
			<!-- Col header -->
			<div class="flex items-center gap-2 px-0.5">
				<span class="text-[11px] font-bold tracking-[0.08em] text-[#aaa] uppercase">Questions</span>
				<span
					class="rounded-xl border border-[#e0e0e0] bg-[#f4f4f4] px-[7px] py-px text-[11px] font-bold text-[#888]"
				>
					{filteredQuestions.length}
				</span>
			</div>

			<!-- List -->
			{#if workingQuestions.length === 0}
				<div class="rounded-lg border border-dashed border-[#e0e0e0] p-8 text-center">
					<p class="m-0 text-[13px] text-[#aaa]">No questions yet. Add one below.</p>
				</div>
			{:else}
				<!-- `listEl.children` is what startDrag measures, so this element must
				     hold exactly one child per visible row. -->
				<div class="flex flex-col gap-1.5" bind:this={listEl}>
					{#each filteredQuestions as q, i (q.id)}
						<QuestionListItem
							question={q}
							index={i}
							total={filteredQuestions.length}
							dragging={drag?.id === q.id}
							dragOffset={dragOffsetFor(i)}
							dropEdge={drag && drag.toIndex === i && drag.toIndex !== drag.fromIndex
								? drag.toIndex < drag.fromIndex
									? 'above'
									: 'below'
								: null}
							onEdit={() => openEdit(q)}
							onDelete={() => deleteQuestion(q.id)}
							onDragStart={(clientY) => startDrag(q.id, clientY)}
							onDragMove={updateDrag}
							onDragEnd={endDrag}
							onKeyboardMove={(delta) => moveByKeyboard(q.id, delta)}
						/>
					{/each}
				</div>
			{/if}

			<!-- Add question form -->
			<div class="mt-1 overflow-hidden rounded-[10px] border border-[#e0e0e0] bg-white">
				<div
					class="flex items-center gap-[7px] border-b border-[#e0e0e0] bg-[#f4f4f4] px-3.5 py-2.5 text-xs font-bold tracking-[0.01em] text-[#444]"
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="12" y1="5" x2="12" y2="19"></line>
						<line x1="5" y1="12" x2="19" y2="12"></line>
					</svg>
					Add Question
				</div>
				<div class="flex flex-col gap-2 p-3.5">
					<input
						type="text"
						bind:value={addTitle}
						placeholder="Question title…"
						onkeydown={(e) => e.key === 'Enter' && handleQuickAdd()}
						class="box-border w-full rounded-md border border-[#e0e0e0] bg-white px-2.5 py-2 text-[13px] text-[#191919] transition-[border-color,box-shadow] duration-[120ms] outline-none focus:border-[#191919] focus:shadow-[0_0_0_2px_rgba(25,25,25,0.07)]"
					/>
					<div class="flex gap-2">
						<Combobox
							options={QUESTION_TYPES}
							value={addType}
							onChange={(next) => (addType = next as QuestionType)}
							ariaLabel="New question type"
							class="flex-1"
						/>
						<button
							class="cursor-pointer rounded-md border border-[#191919] bg-[#191919] px-5 py-2 text-[13px] font-semibold whitespace-nowrap text-white transition-colors duration-[120ms] hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-35"
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
		<div class="lg:sticky lg:top-5 lg:h-[calc(100vh-120px)]">
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
	seed={addSeed}
	isOpen={editorOpen}
	onSave={handleEditorSave}
	onCancel={() => {
		editorOpen = false;
		editingQuestion = null;
	}}
/>

<ConfirmationModal
	isOpen={confirmOpen}
	changes={{
		added: pendingChanges.added,
		modified: pendingChanges.modified,
		deleted: pendingChanges.deleted,
		reordered: pendingChanges.reordered.length > 0
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
		class="fixed right-6 bottom-6 z-[100] flex animate-[slideUp_0.2s_ease] items-center gap-2 rounded-[9px] px-[18px] py-3 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
		class:bg-[#191919]={toastKind === 'success'}
		class:bg-[#b00000]={toastKind === 'error'}
	>
		{#if toastKind === 'success'}
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="20 6 9 17 4 12"></polyline>
			</svg>
		{:else}
			<svg
				width="14"
				height="14"
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
		{/if}
		{toastMsg}
	</div>
{/if}

<style>
	@keyframes slideUp {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
