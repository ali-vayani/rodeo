<script lang="ts">
	import { tick } from 'svelte';
	import type { Question, QuestionType } from '$lib/generated/prisma/client';
	import { LINKED_FIELD_LABEL } from '$lib/linkedFields';

	interface Props {
		question: Question;
		index: number;
		/** Visible row count, announced in the handle's label. */
		total: number;
		dragging?: boolean;
		/** Edge to draw the landing indicator on. */
		dropEdge?: 'above' | 'below' | null;
		/** px. Follows the pointer on the dragged row; a one-slot shift on rows it passes. */
		dragOffset?: number;
		onEdit: () => void;
		onDelete: () => void;
		onDragStart: (clientY: number) => void;
		onDragMove: (clientY: number) => void;
		onDragEnd: (cancelled: boolean) => void;
		/** Keyboard reorder: -1 moves the row up one slot, +1 down one slot. */
		onKeyboardMove: (delta: -1 | 1) => void;
	}

	let {
		question,
		index,
		total,
		dragging = false,
		dropEdge = null,
		dragOffset = 0,
		onEdit,
		onDelete,
		onDragStart,
		onDragMove,
		onDragEnd,
		onKeyboardMove
	}: Props = $props();

	let handleEl = $state<HTMLButtonElement | null>(null);
	// Not `$state`: nothing renders off it.
	let activePointer: number | null = null;

	// Pointer events, not HTML5 drag-and-drop: `dragstart` never fires from a touch.
	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0 || activePointer !== null) return;
		// Stops text selection while dragging; also stops click-to-focus, hence the explicit focus.
		event.preventDefault();
		activePointer = event.pointerId;
		handleEl?.setPointerCapture(event.pointerId);
		handleEl?.focus();
		onDragStart(event.clientY);
	}

	function handlePointerMove(event: PointerEvent) {
		if (activePointer !== event.pointerId) return;
		onDragMove(event.clientY);
	}

	function endDrag(event: PointerEvent, cancelled: boolean) {
		if (activePointer !== event.pointerId) return;
		activePointer = null;
		if (handleEl?.hasPointerCapture(event.pointerId)) {
			handleEl.releasePointerCapture(event.pointerId);
		}
		onDragEnd(cancelled);
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		// Otherwise the arrow scrolls the page out from under the row.
		event.preventDefault();
		onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1);
		// The keyed `{#each}` relocates the node, but the move can still drop focus.
		await tick();
		handleEl?.focus();
	}

	const TYPE_LABELS: Record<QuestionType, string> = {
		MULTIPLE_CHOICE: 'Multiple Choice',
		MULTI_SELECT: 'Multi-Select',
		DROPDOWN: 'Dropdown',
		NUMBER: 'Number',
		CHECKBOX: 'Checkbox',
		SHORT_TEXT: 'Short Text',
		LONG_TEXT: 'Long Text',
		FILE: 'File Upload'
	};

	const TYPE_COLORS: Record<QuestionType, string> = {
		MULTIPLE_CHOICE: '#7c3aed',
		MULTI_SELECT: '#4338ca',
		DROPDOWN: '#0369a1',
		NUMBER: '#b45309',
		CHECKBOX: '#047857',
		SHORT_TEXT: '#374151',
		LONG_TEXT: '#1d4ed8',
		FILE: '#be185d'
	};
</script>

<div
	class="item"
	class:dragging
	class:drop-above={dropEdge === 'above'}
	class:drop-below={dropEdge === 'below'}
	style={dragOffset ? `transform: translateY(${dragOffset}px)` : undefined}
>
	<div class="item-left">
		<button
			bind:this={handleEl}
			class="drag-handle"
			type="button"
			tabindex="0"
			aria-label="Reorder {question.title}, position {index +
				1} of {total}. Press the up or down arrow key to move it."
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={(e) => endDrag(e, false)}
			onpointercancel={(e) => endDrag(e, true)}
			onkeydown={handleKeydown}
		>
			<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
				<circle cx="2.5" cy="3" r="1.5" />
				<circle cx="7.5" cy="3" r="1.5" />
				<circle cx="2.5" cy="8" r="1.5" />
				<circle cx="7.5" cy="8" r="1.5" />
				<circle cx="2.5" cy="13" r="1.5" />
				<circle cx="7.5" cy="13" r="1.5" />
			</svg>
		</button>
		<span class="index">{index + 1}</span>
		<div class="info">
			<div class="title-row">
				<span class="title">{question.title}</span>
				{#if question.required}
					<span class="required-badge">Required</span>
				{/if}
				{#if question.walkIn}
					<span class="walkin-badge">Walk-in</span>
				{/if}
			</div>
			<div class="meta">
				<span
					class="type-badge"
					style="background: {TYPE_COLORS[question.type]}15; color: {TYPE_COLORS[
						question.type
					]}; border: 1px solid {TYPE_COLORS[question.type]}30"
				>
					{TYPE_LABELS[question.type]}
				</span>
				{#if question.targetRole && question.targetRole.length > 0}
					<div class="roles">
						{#each question.targetRole as role (role)}
							<span class="role-chip">{role}</span>
						{/each}
					</div>
				{/if}
				{#if question.linkedField}
					<span class="linked">↔ {LINKED_FIELD_LABEL[question.linkedField]}</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="actions">
		<button class="btn-edit" onclick={onEdit}>Edit</button>
		<button class="btn-delete" onclick={onDelete} aria-label="Delete question">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="3 6 5 6 21 6"></polyline>
				<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"></path>
				<path d="M10 11v6M14 11v6"></path>
				<path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"></path>
			</svg>
		</button>
	</div>
</div>

<style>
	.item {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s ease-out;
	}

	.item:hover {
		border-color: #c0c0c0;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}

	.item.dragging {
		z-index: 2;
		border-color: var(--color-primary);
		box-shadow: var(--shadow-md);
		cursor: grabbing;
		/* Snaps to the pointer, so no `transform` transition. */
		transition: none;
	}

	/* Landing indicator, drawn in the 6px gap between rows. */
	.item.drop-above::before,
	.item.drop-below::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		border-radius: 2px;
		background: var(--color-primary);
	}

	.item.drop-above::before {
		top: -4px;
	}

	.item.drop-below::after {
		bottom: -4px;
	}

	.item-left {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-width: 0;
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		align-self: stretch;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-neutral-400);
		cursor: grab;
		/* Otherwise a touch-drag scrolls the page instead of moving the row. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		transition: color 0.12s;
	}

	.drag-handle:hover {
		color: var(--color-neutral-600);
	}

	.drag-handle:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-radius: var(--radius-sm);
		color: var(--color-neutral-600);
	}

	.drag-handle:active,
	.item.dragging .drag-handle {
		cursor: grabbing;
		color: var(--color-primary);
	}

	.index {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 700;
		color: #aaa;
		padding-top: 2px;
		min-width: 16px;
		text-align: right;
	}

	.info {
		min-width: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.title {
		font-size: var(--text-base);
		font-weight: 600;
		color: #191919;
		line-height: 1.3;
	}

	.required-badge {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: #b00000;
		background: #b0000012;
		border: 1px solid #b0000030;
		border-radius: 4px;
		padding: 1px 6px;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
	}

	.walkin-badge {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: #5b21b6;
		background: #5b21b612;
		border: 1px solid #5b21b630;
		border-radius: 4px;
		padding: 1px 6px;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 5px;
		flex-wrap: wrap;
	}

	/* Sans, not a mono eyebrow: it labels the row rather than classifying it. */
	.type-badge {
		font-size: var(--text-sm);
		font-weight: 500;
		padding: 2px 7px;
		border-radius: 4px;
		white-space: nowrap;
	}

	.roles {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.role-chip {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		color: #666;
		background: #f4f4f4;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
		padding: 1px 6px;
	}

	.linked {
		font-size: var(--text-sm);
		color: #888;
		font-style: italic;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.btn-edit {
		font-size: var(--text-sm);
		font-weight: 500;
		color: #191919;
		background: #f4f4f4;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 5px 12px;
		cursor: pointer;
		transition: all 0.12s;
	}

	.btn-edit:hover {
		background: #191919;
		border-color: #191919;
		color: #fff;
	}

	.btn-delete {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		background: #fff;
		color: #aaa;
		cursor: pointer;
		transition: all 0.12s;
		padding: 0;
	}

	.btn-delete:hover {
		background: #b00000;
		border-color: #b00000;
		color: #fff;
	}
</style>
