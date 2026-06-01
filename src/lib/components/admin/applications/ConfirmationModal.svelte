<script lang="ts">

  import type { Question, QuestionType, Role } from '$lib/generated/prisma/client';
 
  interface Changes {
    added: Question[];
    modified: Question[];
    deleted: Question[];
    reordered: boolean;
  }

  interface Props {
    isOpen: boolean;
    changes: Changes;
    isSaving?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { isOpen, changes, isSaving = false, onConfirm, onCancel }: Props = $props();

  function truncate(str: string, max = 60): string {
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  const totalChanges = $derived(
    changes.added.length + changes.modified.length + changes.deleted.length + (changes.reordered ? 1 : 0)
  );

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) onCancel();
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={(e) => e.key === 'Escape' && onCancel()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Confirm Changes">
      <div class="modal-header">
        <div class="header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div>
          <h2>Confirm Changes</h2>
          <p class="subtitle">{totalChanges} change{totalChanges !== 1 ? 's' : ''} pending</p>
        </div>
      </div>

      <div class="modal-body">
        <p class="intro">You are about to save the following changes to the application form:</p>

        {#if changes.added.length > 0}
          <div class="change-section added">
            <div class="section-header">
              <span class="dot"></span>
              <h3>Added ({changes.added.length})</h3>
            </div>
            <ul>
              {#each changes.added as q}
                <li>
                  <span class="q-title">{truncate(q.title)}</span>
                  <span class="q-type">{q.type.replace('_', ' ')}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if changes.modified.length > 0}
          <div class="change-section modified">
            <div class="section-header">
              <span class="dot"></span>
              <h3>Modified ({changes.modified.length})</h3>
            </div>
            <ul>
              {#each changes.modified as q}
                <li>
                  <span class="q-title">{truncate(q.title)}</span>
                  <span class="q-badge">updated</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if changes.deleted.length > 0}
          <div class="change-section deleted">
            <div class="section-header">
              <span class="dot"></span>
              <h3>Deleted ({changes.deleted.length})</h3>
            </div>
            <ul>
              {#each changes.deleted as q}
                <li>
                  <span class="q-title">{truncate(q.title)}</span>
                  <span class="q-badge danger">removed</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if changes.reordered}
          <div class="change-section reordered">
            <div class="section-header">
              <span class="dot"></span>
              <h3>Order Changed</h3>
            </div>
            <p class="reorder-note">Questions will be reordered as shown in the list.</p>
          </div>
        {/if}

        <div class="warning-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>These changes will affect all future applicants. Deleted questions cannot be recovered.</p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" onclick={onCancel} disabled={isSaving}>Cancel</button>
        <button class="btn-confirm" onclick={onConfirm} disabled={isSaving}>
          {#if isSaving}
            <span class="spinner"></span>
            Saving…
          {:else}
            Confirm &amp; Save
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
    max-width: 460px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,0.22);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 20px 24px 16px;
    border-bottom: 1px solid #e0e0e0;
  }

  .header-icon {
    width: 36px;
    height: 36px;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #b45309;
    flex-shrink: 0;
  }

  .modal-header h2 {
    font-size: 15px;
    font-weight: 700;
    color: #191919;
    margin: 0 0 2px;
  }

  .subtitle {
    font-size: 12px;
    color: #888;
    margin: 0;
  }

  .modal-body {
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .intro {
    font-size: 13px;
    color: #555;
    margin: 0;
  }

  .change-section {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e0e0e0;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #f4f4f4;
    border-bottom: 1px solid #e0e0e0;
  }

  .section-header h3 {
    font-size: 12px;
    font-weight: 700;
    color: #444;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .added .dot { background: #16a34a; }
  .modified .dot { background: #0369a1; }
  .deleted .dot { background: #b00000; }
  .reordered .dot { background: #b45309; }

  .change-section ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .change-section ul li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    font-size: 13px;
    border-bottom: 1px solid #f0f0f0;
  }

  .change-section ul li:last-child {
    border-bottom: none;
  }

  .q-title {
    color: #191919;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-type {
    font-size: 11px;
    color: #888;
    font-weight: 500;
    white-space: nowrap;
    text-transform: capitalize;
  }

  .q-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    background: #dbeafe;
    color: #0369a1;
  }

  .q-badge.danger {
    background: #fee2e2;
    color: #b00000;
  }

  .reorder-note {
    font-size: 12px;
    color: #888;
    margin: 0;
    padding: 8px 12px;
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
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>