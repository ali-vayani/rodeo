<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import Field from './Field.svelte';
	import { controlClass } from './controlStyles';

	let {
		value = $bindable(),
		label = undefined,
		hint = undefined,
		error = undefined,
		required = false,
		mono = false,
		invalid = false,
		rows = 3,
		class: className = '',
		fieldClass = '',
		...rest
	}: {
		value?: string;
		label?: string;
		hint?: string;
		error?: string | null;
		required?: boolean;
		mono?: boolean;
		invalid?: boolean;
		rows?: number;
		class?: string;
		fieldClass?: string;
	} & Omit<HTMLTextareaAttributes, 'value' | 'class' | 'rows'> = $props();

	function areaClass(isInvalid: boolean) {
		return controlClass({
			invalid: isInvalid,
			mono,
			sized: false,
			class: cn('resize-y px-3 py-2', className)
		});
	}
</script>

{#if label !== undefined || hint !== undefined || error !== undefined}
	<Field {label} {hint} {error} {required} class={fieldClass}>
		{#snippet children({ id, invalid: fieldInvalid, describedBy })}
			<textarea
				{id}
				{rows}
				bind:value
				{required}
				aria-invalid={fieldInvalid || undefined}
				aria-describedby={describedBy}
				class={areaClass(fieldInvalid)}
				{...rest}
			></textarea>
		{/snippet}
	</Field>
{:else}
	<textarea
		{rows}
		bind:value
		{required}
		aria-invalid={invalid || undefined}
		class={areaClass(invalid)}
		{...rest}
	></textarea>
{/if}
