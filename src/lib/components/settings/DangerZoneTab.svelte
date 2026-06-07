<script lang="ts">
	import { createClient } from '$lib/trpc/client';

	let {
		onToast
	}: {
		onToast: (message: string, type?: 'success' | 'error') => void;
	} = $props();

	const trpc = createClient();

	let showReleaseModal = $state(false);
	let releaseConfirmText = $state('');
	let releasing = $state(false);
	let pendingCount = $state<number | null>(null);
	let countLoading = $state(false);

	async function openReleaseModal() {
		releaseConfirmText = '';
		showReleaseModal = true;
		countLoading = true;
		try {
			const applicants = await trpc.admissions.list.query({});
			pendingCount = applicants.filter((a) => a.pendingDecision !== null).length;
		} catch {
			pendingCount = null;
		} finally {
			countLoading = false;
		}
	}

	function closeReleaseModal() {
		if (releasing) return;
		showReleaseModal = false;
		releaseConfirmText = '';
		pendingCount = null;
	}

	async function handleRelease() {
		releasing = true;
		try {
			const result = await trpc.admissions.release.mutate({});
			closeReleaseModal();
			onToast(
				`Released decisions for ${result.released} user${result.released === 1 ? '' : 's'}`
			);
		} catch (e: any) {
			onToast(e.message ?? 'Release failed', 'error');
		} finally {
			releasing = false;
		}
	}
</script>

<div class="max-w-[520px] space-y-3">
	<!-- Release Decisions -->
	<div class="border border-[#fca5a5] rounded px-5 py-4">
		<div class="text-[13px] font-semibold text-primary mb-1">Release Decisions</div>
		<p class="text-xs text-muted-foreground mb-4">
			Copy all pending decisions to active decisions and send notification emails to applicants.
			This action cannot be undone.
		</p>
		<button
			onclick={openReleaseModal}
			class="text-[13px] font-semibold text-white bg-destructive border-none rounded-md py-[9px] px-[18px] cursor-pointer"
		>
			Release Decisions
		</button>
	</div>

</div>

<!-- Release modal -->
{#if showReleaseModal}
	<div
		role="presentation"
		onclick={closeReleaseModal}
		class="fixed inset-0 bg-black/45 z-[100] flex items-center justify-center"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Release decisions"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeReleaseModal()}
			class="bg-white rounded-lg w-[480px] max-w-[calc(100vw-48px)] shadow-[0_8px_32px_rgba(0,0,0,0.18)] overflow-hidden"
		>
			<!-- Header -->
			<div class="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between">
				<div>
					<div class="text-[16px] font-bold text-primary">Release Decisions</div>
					<div class="text-[13px] text-muted-foreground mt-1">
						This will copy all pending decisions to active decisions and send notification emails.
					</div>
				</div>
				<button
					onclick={closeReleaseModal}
					class="text-xl leading-none bg-transparent border-none text-muted-foreground cursor-pointer p-0 -mt-0.5"
					aria-label="Close"
				>
					×
				</button>
			</div>

			<!-- Body -->
			<div class="px-6 py-5">
				<div class="bg-[#fff3f3] border border-[#fca5a5] rounded px-[14px] py-3 mb-5">
					{#if countLoading}
						<div class="text-[13px] text-muted-foreground">Loading…</div>
					{:else if pendingCount !== null}
						<div class="text-[13px] font-semibold text-destructive mb-1">
							{pendingCount} user{pendingCount === 1 ? '' : 's'} will be affected
						</div>
					{:else}
						<div class="text-[13px] font-semibold text-destructive mb-1">
							All pending decisions will be released
						</div>
					{/if}
					<div class="text-xs text-muted-foreground">
						Emails will be sent for all accepted, rejected, and waitlisted decisions. This action
						cannot be undone.
					</div>
				</div>

				<div class="mb-4">
					<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">
						Type <span class="font-mono bg-[#f0f0f0] px-[5px] py-px rounded normal-case tracking-normal">RELEASE</span> to confirm
					</div>
					<input
						id="release-confirm-settings"
						type="text"
						bind:value={releaseConfirmText}
						placeholder="RELEASE"
						class="w-full text-[13px] text-primary bg-white border border-border rounded px-3 py-[7px] outline-none font-mono"
					/>
				</div>
			</div>

			<!-- Footer -->
			<div class="px-6 py-4 border-t border-border flex justify-end gap-[10px]">
				<button
					onclick={closeReleaseModal}
					disabled={releasing}
					class="text-[13px] font-medium text-primary bg-white border border-border rounded-md py-[9px] px-[14px] cursor-pointer disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					onclick={handleRelease}
					disabled={releaseConfirmText !== 'RELEASE' ||
						releasing ||
						(pendingCount !== null && pendingCount === 0)}
					class="text-[13px] font-semibold text-white bg-destructive border-none rounded-md py-[9px] px-[18px] cursor-pointer disabled:opacity-40"
				>
					{releasing
						? 'Releasing…'
						: pendingCount !== null
							? `Release ${pendingCount} Decision${pendingCount === 1 ? '' : 's'}`
							: 'Release Decisions'}
				</button>
			</div>
		</div>
	</div>
{/if}
