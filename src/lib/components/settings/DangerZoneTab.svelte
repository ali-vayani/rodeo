<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { createClient } from '$lib/trpc/client';
	import { Modal } from '$lib/components/ui';

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
			const { applicants } = await trpc.admissions.list.query({});
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
			onToast(`Released decisions for ${result.released} user${result.released === 1 ? '' : 's'}`);
		} catch (e) {
			onToast(errorMessage(e, 'Release failed'), 'error');
		} finally {
			releasing = false;
		}
	}
</script>

<div class="max-w-[520px] space-y-3">
	<!-- Release Decisions -->
	<div class="rounded border border-[#fca5a5] px-5 py-4">
		<div class="mb-1 text-[13px] font-semibold text-primary">Release Decisions</div>
		<p class="mb-4 text-xs text-muted-foreground">
			Copy all pending decisions to active decisions and send notification emails to applicants.
			This action cannot be undone.
		</p>
		<button
			onclick={openReleaseModal}
			class="cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-white"
		>
			Release Decisions
		</button>
	</div>
</div>

<!-- Release modal — shared Modal handles the overlay, focus trap, Escape, and
     mobile sizing (width: calc(100% - 2rem), so it fits a 320px screen). -->
<Modal
	bind:open={showReleaseModal}
	title="Release Decisions"
	description="This will copy all pending decisions to active decisions and send notification emails."
	size="md"
	dismissible={!releasing}
	onClose={closeReleaseModal}
>
	<div class="mb-5 rounded border border-[#fca5a5] bg-[#fff3f3] px-[14px] py-3">
		{#if countLoading}
			<div class="text-[13px] text-muted-foreground">Loading…</div>
		{:else if pendingCount !== null}
			<div class="mb-1 text-[13px] font-semibold text-destructive">
				{pendingCount} user{pendingCount === 1 ? '' : 's'} will be affected
			</div>
		{:else}
			<div class="mb-1 text-[13px] font-semibold text-destructive">
				All pending decisions will be released
			</div>
		{/if}
		<div class="text-xs text-muted-foreground">
			Emails will be sent for all accepted, rejected, and waitlisted decisions. This action cannot
			be undone.
		</div>
	</div>

	<div>
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Type <span class="rounded bg-[#f0f0f0] px-[5px] py-px font-mono tracking-normal normal-case"
				>RELEASE</span
			> to confirm
		</div>
		<input
			id="release-confirm-settings"
			type="text"
			bind:value={releaseConfirmText}
			placeholder="RELEASE"
			class="w-full rounded border border-border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none"
		/>
	</div>

	{#snippet footer()}
		<button
			onclick={closeReleaseModal}
			disabled={releasing}
			class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium text-primary disabled:opacity-50"
		>
			Cancel
		</button>
		<button
			onclick={handleRelease}
			disabled={releaseConfirmText !== 'RELEASE' ||
				releasing ||
				(pendingCount !== null && pendingCount === 0)}
			class="cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-40"
		>
			{releasing
				? 'Releasing…'
				: pendingCount !== null
					? `Release ${pendingCount} Decision${pendingCount === 1 ? '' : 's'}`
					: 'Release Decisions'}
		</button>
	{/snippet}
</Modal>
