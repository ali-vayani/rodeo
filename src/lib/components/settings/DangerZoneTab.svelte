<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { createClient } from '$lib/trpc/client';
	import { Modal } from '$lib/components/ui';
	import { downloadExport } from './DataExportTab.svelte';

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

	// Export-and-wipe
	let showWipeModal = $state(false);
	let wipePassword = $state('');
	let wipeConfirmText = $state('');
	let wiping = $state(false);
	/** What the operator is waiting on, so the button can say which half is running. */
	let wipeStage = $state<'idle' | 'exporting' | 'wiping'>('idle');

	function openWipeModal() {
		wipePassword = '';
		wipeConfirmText = '';
		wipeStage = 'idle';
		showWipeModal = true;
	}

	function closeWipeModal() {
		if (wiping) return;
		showWipeModal = false;
		wipePassword = '';
		wipeConfirmText = '';
	}

	/**
	 * Export first, save the file, and only then delete.
	 *
	 * The order is the whole safety property, which is why it lives in the client
	 * rather than in one server call: the backup has to be on disk before anything
	 * is destroyed. A server-side "export then wipe" would put the only copy of
	 * the data in a response body sent *after* the delete, where a dropped
	 * connection loses it permanently. If either the export or the download throws,
	 * this returns before `wipe` is ever called and nothing has been touched.
	 */
	async function handleExportAndWipe() {
		wiping = true;
		try {
			wipeStage = 'exporting';
			const { json, counts } = await trpc.data.exportAll.mutate({ password: wipePassword });
			downloadExport(json);

			wipeStage = 'wiping';
			const deleted = await trpc.data.wipe.mutate({ password: wipePassword, confirm: 'WIPE' });

			showWipeModal = false;
			wipePassword = '';
			wipeConfirmText = '';
			onToast(
				`Exported ${counts.user} users, then removed ${deleted.user}. Staff and blacklist kept.`
			);
		} catch (e) {
			// Reached from either half. If it was the export, nothing was deleted;
			// if it was the wipe, the file is already saved.
			onToast(
				errorMessage(
					e,
					wipeStage === 'exporting' ? 'Export failed — nothing was deleted' : 'Wipe failed'
				),
				'error'
			);
		} finally {
			wiping = false;
			wipeStage = 'idle';
		}
	}

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

	<!-- Export and wipe -->
	<div class="rounded border border-[#fca5a5] px-5 py-4">
		<div class="mb-1 text-[13px] font-semibold text-primary">Export and Wipe Database</div>
		<p class="mb-4 text-xs text-muted-foreground">
			Downloads a full JSON export, then empties every table. Admin and organizer accounts and the
			blacklist are kept; everyone else, along with their applications, teams, scans, logs and the
			event settings, is deleted. Nothing is deleted until the export has downloaded.
		</p>
		<button
			onclick={openWipeModal}
			class="cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-white"
		>
			Export and Wipe Database
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

<!-- Export-and-wipe modal. Two independent gates: the password proves authority,
     the typed word proves intent. Neither substitutes for the other. -->
<Modal
	bind:open={showWipeModal}
	title="Export and Wipe Database"
	description="A full export downloads first. Only then is anything deleted."
	size="md"
	dismissible={!wiping}
	onClose={closeWipeModal}
>
	<div class="mb-5 rounded border border-[#fca5a5] bg-[#fff3f3] px-[14px] py-3">
		<div class="mb-1 text-[13px] font-semibold text-destructive">This cannot be undone</div>
		<div class="text-xs text-foreground-secondary">
			<p class="mt-0 mb-1.5">
				<strong>Kept:</strong> admin and organizer accounts, and the blacklist.
			</p>
			<p class="m-0">
				<strong>Deleted:</strong> all other users, applications, questions, schedule, scans, teams, groups,
				invitations, email history, the audit log and the event settings.
			</p>
		</div>
	</div>

	<div class="mb-4">
		<label
			for="wipe-password"
			class="mb-1.5 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
		>
			Data password
		</label>
		<input
			id="wipe-password"
			type="password"
			bind:value={wipePassword}
			autocomplete="off"
			placeholder="Required"
			disabled={wiping}
			class="w-full rounded border border-border bg-white px-3 py-[7px] text-[13px] text-primary outline-none focus-visible:shadow-ring"
		/>
	</div>

	<div>
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Type <span class="rounded bg-[#f0f0f0] px-[5px] py-px font-mono tracking-normal normal-case"
				>WIPE</span
			> to confirm
		</div>
		<input
			id="wipe-confirm"
			type="text"
			bind:value={wipeConfirmText}
			placeholder="WIPE"
			disabled={wiping}
			class="w-full rounded border border-border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none focus-visible:shadow-ring"
		/>
	</div>

	{#snippet footer()}
		<button
			onclick={closeWipeModal}
			disabled={wiping}
			class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium text-primary disabled:opacity-50"
		>
			Cancel
		</button>
		<button
			onclick={handleExportAndWipe}
			disabled={wiping || wipeConfirmText !== 'WIPE' || wipePassword.length === 0}
			class="cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-40"
		>
			{wipeStage === 'exporting'
				? 'Exporting…'
				: wipeStage === 'wiping'
					? 'Wiping…'
					: 'Export and Wipe'}
		</button>
	{/snippet}
</Modal>
