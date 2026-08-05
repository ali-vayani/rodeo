<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import Eyebrow from './Eyebrow.svelte';

	let {
		label = undefined,
		hint = undefined,
		error = undefined,
		required = false,
		class: className = '',
		children
	}: {
		label?: string;
		/** Guidance shown under the control. Hidden while an error is showing. */
		hint?: string;
		/** Non-empty puts the field in its invalid state. */
		error?: string | null;
		required?: boolean;
		class?: string;
		/**
		 * Receives the wiring so the control doesn't have to invent ids:
		 * `{#snippet children({ id, invalid, describedBy })}`
		 */
		children: Snippet<[{ id: string; invalid: boolean; describedBy: string | undefined }]>;
	} = $props();

	const uid = $props.id();
	const id = `${uid}-control`;
	const messageId = `${uid}-message`;

	const invalid = $derived(Boolean(error));
	const hasMessage = $derived(Boolean(error || hint));
	const describedBy = $derived(hasMessage ? messageId : undefined);
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
	{#if label}
		<Eyebrow as="label" for={id}>
			{label}{#if required}<span class="text-danger-500" aria-hidden="true"> *</span>{/if}
		</Eyebrow>
	{/if}

	{@render children({ id, invalid, describedBy })}

	<!--
		One message slot, not two. An error replaces the hint rather than stacking
		under it, so the control never grows taller on the way to being wrong.
	-->
	{#if hasMessage}
		<span
			id={messageId}
			class={cn('text-xs', error ? 'text-danger-700' : 'text-foreground-tertiary')}
		>
			{error || hint}
		</span>
	{/if}
</div>
