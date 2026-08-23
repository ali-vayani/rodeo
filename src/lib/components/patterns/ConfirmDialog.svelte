<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';

	let {
		open = $bindable(false),
		title,
		description = undefined,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		tone = 'danger',
		confirmPhrase = undefined,
		loading = false,
		disabled = false,
		size = 'sm',
		onConfirm,
		onCancel = undefined,
		children
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		tone?: 'danger' | 'primary';
		/**
		 * Requires the operator to type this word before confirming. Deliberate
		 * friction for irreversible batch actions — RELEASE, SEND.
		 */
		confirmPhrase?: string;
		loading?: boolean;
		/** Blocks confirm for reasons the dialog can't know, e.g. an empty batch. */
		disabled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		onConfirm: () => void;
		onCancel?: () => void;
		/** Extra context above the confirm gate — a count, a preview, a summary. */
		children?: Snippet;
	} = $props();

	let typed = $state('');

	// Reset on every open so a previous attempt never leaves the gate satisfied.
	$effect(() => {
		if (open) typed = '';
	});

	const phraseSatisfied = $derived(!confirmPhrase || typed === confirmPhrase);
	const canConfirm = $derived(phraseSatisfied && !loading && !disabled);

	function cancel() {
		open = false;
		onCancel?.();
	}
</script>

<Modal bind:open {title} {description} {size} dismissible={!loading}>
	{#if children}{@render children()}{/if}

	{#if confirmPhrase}
		<div class={children ? 'mt-4' : ''}>
			<Input
				bind:value={typed}
				mono
				autocomplete="off"
				disabled={loading}
				placeholder={confirmPhrase}
				class="max-w-56"
				fieldClass="max-w-56"
				label="Type {confirmPhrase} to confirm"
			/>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={cancel} disabled={loading}>{cancelLabel}</Button>
		<Button
			variant={tone === 'danger' ? 'danger' : 'primary'}
			onclick={onConfirm}
			disabled={!canConfirm}
			{loading}
		>
			{confirmLabel}
		</Button>
	{/snippet}
</Modal>
