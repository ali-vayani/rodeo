<script lang="ts">
	import { Switch } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		checked = $bindable(false),
		label = undefined,
		disabled = false,
		class: className = ''
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	const id = $props.id();
</script>

<div class={cn('flex items-center gap-2.5', className)}>
	<Switch.Root
		{id}
		bind:checked
		{disabled}
		class="inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border
		       border-transparent bg-neutral-300 px-0.5 transition-colors duration-150
		       focus-visible:shadow-ring disabled:cursor-not-allowed
		       disabled:opacity-50 data-[state=checked]:bg-primary"
	>
		<Switch.Thumb
			class="pointer-events-none block size-3.5 rounded-full bg-card shadow-xs
			       transition-transform duration-150 ease-out-quick
			       data-[state=checked]:translate-x-3.5"
		/>
	</Switch.Root>

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
