<script lang="ts">
	import type { Question, QuestionType, Role } from '$lib/generated/prisma/client';

	interface Props {
		question: Question;
		index: number;
		canMoveUp: boolean;
		canMoveDown: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onMoveUp: () => void;
		onMoveDown: () => void;
	}

	let { question, index, canMoveUp, canMoveDown, onEdit, onDelete, onMoveUp, onMoveDown }: Props =
		$props();

	const TYPE_LABELS: Record<QuestionType, string> = {
		MULTIPLE_CHOICE: 'Multiple Choice',
		DROPDOWN: 'Dropdown',
		NUMBER: 'Number',
		CHECKBOX: 'Checkbox',
		SHORT_TEXT: 'Short Text',
		LONG_TEXT: 'Long Text'
	};

	const TYPE_COLORS: Record<QuestionType, string> = {
		MULTIPLE_CHOICE: '#7c3aed',
		DROPDOWN: '#0369a1',
		NUMBER: '#b45309',
		CHECKBOX: '#047857',
		SHORT_TEXT: '#374151',
		LONG_TEXT: '#1d4ed8'
	};
</script>

<div class="item">
	<div class="item-left">
		<span class="index">{index + 1}</span>
		<div class="info">
			<div class="title-row">
				<span class="title">{question.title}</span>
				{#if question.required}
					<span class="required-badge">Required</span>
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
						{#each question.targetRole as role}
							<span class="role-chip">{role}</span>
						{/each}
					</div>
				{/if}
				{#if question.linkedField}
					<span class="linked">↔ {question.linkedField}</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="actions">
		<div class="reorder-btns">
			<button
				class="icon-btn"
				onclick={onMoveUp}
				disabled={!canMoveUp}
				title="Move up"
				aria-label="Move question up"
			>
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
					<path d="M18 15l-6-6-6 6" />
				</svg>
			</button>
			<button
				class="icon-btn"
				onclick={onMoveDown}
				disabled={!canMoveDown}
				title="Move down"
				aria-label="Move question down"
			>
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
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
		</div>
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
			box-shadow 0.15s;
	}

	.item:hover {
		border-color: #c0c0c0;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}

	.item-left {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-width: 0;
	}

	.index {
		font-size: 11px;
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
		font-size: 13.5px;
		font-weight: 600;
		color: #191919;
		line-height: 1.3;
	}

	.required-badge {
		font-size: 10px;
		font-weight: 600;
		color: #b00000;
		background: #b0000012;
		border: 1px solid #b0000030;
		border-radius: 4px;
		padding: 1px 6px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 5px;
		flex-wrap: wrap;
	}

	.type-badge {
		font-size: 11px;
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
		font-size: 10px;
		font-weight: 500;
		color: #666;
		background: #f4f4f4;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
		padding: 1px 6px;
	}

	.linked {
		font-size: 11px;
		color: #888;
		font-style: italic;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.reorder-btns {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
		background: #f4f4f4;
		color: #555;
		cursor: pointer;
		transition: all 0.12s;
		padding: 0;
	}

	.icon-btn:hover:not(:disabled) {
		background: #191919;
		border-color: #191919;
		color: #fff;
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.btn-edit {
		font-size: 12px;
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
