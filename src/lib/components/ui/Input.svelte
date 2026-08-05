<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
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
		class: className = '',
		fieldClass = '',
		...rest
	}: {
		value?: string | number | null;
		/** Given a label, the input wraps itself in a Field. */
		label?: string;
		hint?: string;
		error?: string | null;
		required?: boolean;
		/** For codes, UIDs, datetimes — anything scanned rather than read. */
		mono?: boolean;
		/** Standalone invalid state, for inputs used without a Field. */
		invalid?: boolean;
		class?: string;
		fieldClass?: string;
	} & Omit<HTMLInputAttributes, 'value' | 'class' | 'size'> = $props();

	function inputClass(isInvalid: boolean) {
		return controlClass({ invalid: isInvalid, mono, class: className });
	}
</script>

{#if label !== undefined || hint !== undefined || error !== undefined}
	<Field {label} {hint} {error} {required} class={fieldClass}>
		{#snippet children({ id, invalid: fieldInvalid, describedBy })}
			<input
				{id}
				bind:value
				{required}
				aria-invalid={fieldInvalid || undefined}
				aria-describedby={describedBy}
				class={inputClass(fieldInvalid)}
				{...rest}
			/>
		{/snippet}
	</Field>
{:else}
	<input
		bind:value
		{required}
		aria-invalid={invalid || undefined}
		class={inputClass(invalid)}
		{...rest}
	/>
{/if}
