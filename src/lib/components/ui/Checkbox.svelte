<script lang="ts">
	import { Checkbox } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		checked = $bindable(false),
		label = undefined,
		disabled = false,
		class: className = '',
		...rest
	}: {
		checked?: boolean;
		/** Renders a clickable label beside the box. */
		label?: string;
		disabled?: boolean;
		class?: string;
	} & Record<string, unknown> = $props();

	const id = $props.id();
</script>

<div class={cn('flex items-center gap-2', className)}>
	<Checkbox.Root
		{id}
		bind:checked
		{disabled}
		class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border
		       border-border-strong bg-card transition-colors duration-150
		       focus-visible:shadow-ring disabled:cursor-not-allowed
		       disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
		{...rest}
	>
		{#snippet children({ checked: isChecked })}
			{#if isChecked}
				<span class="text-2xs leading-none font-bold text-primary-foreground" aria-hidden="true">
					✓
				</span>
			{/if}
		{/snippet}
	</Checkbox.Root>

	{#if label}
		<label
			for={id}
			class={cn(
				'cursor-pointer text-base text-foreground select-none',
				disabled && 'cursor-not-allowed opacity-50'
			)}
		>
			{label}
		</label>
	{/if}
</div>
