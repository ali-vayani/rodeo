<script lang="ts">
	import type { BlacklistModel as Blacklist } from '$lib/generated/prisma/models';
	import { ConfirmDialog } from '$lib/components/patterns';

	let {
		open = $bindable(false),
		entry,
		isDeleting = false,
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		entry: Blacklist;
		isDeleting?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<!--
	The manual focus-on-cancel and the hand-rolled backdrop/Escape handling are
	gone: ConfirmDialog sits on bits-ui Dialog, which traps focus, restores it on
	close, and locks scroll.
-->
<ConfirmDialog
	bind:open
	title="Remove from blacklist?"
	description={entry.email
		? 'This address will no longer be auto-rejected on submit.'
		: 'This name will no longer be flagged for reviewers.'}
	confirmLabel="Remove"
	loading={isDeleting}
	{onConfirm}
	{onCancel}
>
	<div class="rounded-md border border-border bg-muted px-3.5 py-3">
		<div class="text-base font-semibold text-foreground">
			{entry.firstName}
			{entry.lastName}
		</div>
		<div class="mt-0.5 font-mono text-xs text-foreground-secondary">
			{entry.email ?? 'no email — name only'}
		</div>
		{#if entry.reason}
			<div class="mt-1.5 text-sm text-foreground-secondary">{entry.reason}</div>
		{/if}
	</div>
</ConfirmDialog>
