<script lang="ts">
	import { Button, Modal } from '$lib/components/ui';

	/**
	 * What a page asks before letting a reader walk away from unsaved work.
	 *
	 * Paired with `createUnsavedGuard`, which is what holds the navigation. This is only
	 * the question.
	 *
	 * `onSave` is optional because not every draft has somewhere to be saved to: the
	 * custom-email composer's unsent draft can only be kept or thrown away.
	 */
	let {
		open = false,
		title = 'Unsaved changes',
		description,
		saveLabel = 'Save',
		discardLabel = "Don't save",
		saving = false,
		onSave = undefined,
		onDiscard,
		onCancel
	}: {
		open?: boolean;
		title?: string;
		/** What is unsaved, in the page's own words. */
		description: string;
		saveLabel?: string;
		discardLabel?: string;
		/** Keeps the modal up, with the save button spinning, while a save is in flight. */
		saving?: boolean;
		onSave?: () => void;
		onDiscard: () => void;
		onCancel: () => void;
	} = $props();
</script>

<!--
	Labels stay short: three verb phrases overflowed the 400px panel.

	`dismissible` off while saving — Escape or a backdrop click mid-save would leave the
	write running with nothing on screen to report how it went.
-->
<Modal
	{open}
	{title}
	size="sm"
	dismissible={!saving}
	onClose={onCancel}
	bodyClass="text-sm text-foreground-secondary"
>
	{description}

	{#snippet footer()}
		<Button variant="ghost" onclick={onCancel} disabled={saving}>Cancel</Button>
		<Button variant="secondary" onclick={onDiscard} disabled={saving}>{discardLabel}</Button>
		{#if onSave}
			<Button variant="primary" onclick={onSave} loading={saving}>{saveLabel}</Button>
		{/if}
	{/snippet}
</Modal>
