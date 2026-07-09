<script lang="ts">
	import type { Role, UserStatus } from '$lib/generated/prisma/client';

	interface DialogUser {
		uid: string;
		name: string;
		email: string;
		university: string | null;
		year: string | null;
		roles: Role[];
		status: UserStatus;
	}

	interface Props {
		isOpen: boolean;
		user: DialogUser | null;
		action: string;
		isDuplicate: boolean;
		scanCountForAction: number;
		warning: 'UNCONFIRMED_HACKER' | null;
		isConfirming?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		isOpen,
		user,
		action,
		isDuplicate,
		scanCountForAction,
		warning,
		isConfirming = false,
		onConfirm,
		onCancel
	}: Props = $props();

	function handleBackdropClick(e: MouseEvent) {
		if ((e.target as HTMLElement).classList.contains('modal-backdrop')) onCancel();
	}
</script>

{#if isOpen && user}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onCancel()}
	>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Confirm Scan">
			<div class="modal-header">
				<h2>{user.name}</h2>
				<p class="subtitle">{user.roles.join(', ')} &middot; {user.status.replace('_', ' ')}</p>
			</div>

			<div class="modal-body">
				<div class="detail-row">
					<span class="detail-label">Email</span>
					<span class="detail-value">{user.email}</span>
				</div>
				{#if user.university}
					<div class="detail-row">
						<span class="detail-label">University</span>
						<span class="detail-value">{user.university}</span>
					</div>
				{/if}
				<div class="detail-row">
					<span class="detail-label">Scanning for</span>
					<span class="detail-value">{action}</span>
				</div>

				{#if warning === 'UNCONFIRMED_HACKER'}
					<div class="warning-box">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
							<line x1="12" y1="9" x2="12" y2="13"></line>
							<line x1="12" y1="17" x2="12.01" y2="17"></line>
						</svg>
						<p>Status is <strong>{user.status.replace('_', ' ')}</strong> — this hacker hasn't confirmed attendance.</p>
					</div>
				{/if}

				{#if isDuplicate}
					<div class="warning-box">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
							<line x1="12" y1="9" x2="12" y2="13"></line>
							<line x1="12" y1="17" x2="12.01" y2="17"></line>
						</svg>
						<p>Already scanned {scanCountForAction}&times; for {action} — confirming will still record this scan.</p>
					</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button class="btn-cancel" onclick={onCancel} disabled={isConfirming}>Cancel</button>
				<button class="btn-confirm" onclick={onConfirm} disabled={isConfirming}>
					{#if isConfirming}
						<span class="spinner"></span>
						Recording…
					{:else}
						Confirm Scan
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(25, 25, 25, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
		backdrop-filter: blur(3px);
		padding: 20px;
	}

	.modal {
		background: #fff;
		border-radius: 12px;
		width: 100%;
		max-width: 400px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
		overflow: hidden;
		font-family: 'Inter', sans-serif;
	}

	.modal-header {
		padding: 20px 24px 16px;
		border-bottom: 1px solid #e0e0e0;
	}

	.modal-header h2 {
		font-size: 20px;
		font-weight: 700;
		color: #191919;
		margin: 0 0 4px;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-family: 'DM Mono', monospace;
		font-size: 11px;
		color: #888;
		margin: 0;
		text-transform: capitalize;
	}

	.modal-body {
		overflow-y: auto;
		padding: 18px 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}

	.detail-label {
		color: #888;
		flex-shrink: 0;
	}

	.detail-value {
		color: #191919;
		font-weight: 500;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.warning-box {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 12px;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 7px;
		color: #92400e;
		margin-top: 4px;
	}

	.warning-box svg {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.warning-box p {
		font-size: 12px;
		color: #92400e;
		margin: 0;
		line-height: 1.45;
	}

	.modal-footer {
		padding: 16px 24px;
		border-top: 1px solid #e0e0e0;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
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

	.btn-cancel:hover:not(:disabled) {
		border-color: #aaa;
		color: #191919;
	}

	.btn-cancel:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-confirm {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		padding: 8px 18px;
		border: none;
		border-radius: 7px;
		background: #191919;
		color: #fff;
		cursor: pointer;
		transition: background 0.12s;
	}

	.btn-confirm:hover:not(:disabled) {
		background: #333;
	}

	.btn-confirm:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		width: 13px;
		height: 13px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
