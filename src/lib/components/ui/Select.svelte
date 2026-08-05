<script lang="ts">
	import { Select } from 'bits-ui';
	import { cn } from '$lib/utils';
	import Field from './Field.svelte';
	import { controlClass } from './controlStyles';

	import type { SelectOption } from './types';

	let {
		value = $bindable(''),
		options,
		label = undefined,
		hint = undefined,
		error = undefined,
		placeholder = 'Select…',
		required = false,
		disabled = false,
		mono = false,
		invalid = false,
		class: className = '',
		fieldClass = '',
		ariaLabel = undefined,
		onValueChange = undefined
	}: {
		value?: string;
		options: SelectOption[];
		label?: string;
		hint?: string;
		error?: string | null;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		mono?: boolean;
		invalid?: boolean;
		class?: string;
		fieldClass?: string;
		/** For a select with no visible label — a filter bar, a toolbar. */
		ariaLabel?: string;
		/**
		 * Fires only on user selection, unlike an `$effect` on `value`, which also
		 * runs when the parent resets the binding (a "clear filters" button) and
		 * would turn that into a second round-trip.
		 */
		onValueChange?: (value: string) => void;
	} = $props();

	const selectedLabel = $derived(options.find((option) => option.value === value)?.label);
	const wrapped = $derived(label !== undefined || hint !== undefined || error !== undefined);
</script>

{#snippet control(id: string | undefined, isInvalid: boolean, describedBy: string | undefined)}
	<Select.Root type="single" bind:value {disabled} {onValueChange}>
		<Select.Trigger
			{id}
			aria-label={ariaLabel}
			aria-invalid={isInvalid || undefined}
			aria-describedby={describedBy}
			class={cn(
				controlClass({ invalid: isInvalid, mono, class: className }),
				'flex cursor-pointer items-center justify-between gap-2 text-left'
			)}
		>
			<span class={cn('truncate', !selectedLabel && 'text-faint')}>
				{selectedLabel ?? placeholder}
			</span>
			<span class="shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true">▾</span>
		</Select.Trigger>

		<Select.Portal>
			<Select.Content
				class="z-50 max-h-64 w-[var(--bits-select-anchor-width)] overflow-hidden rounded-lg
				       border border-border bg-card p-1 shadow-md"
				sideOffset={4}
			>
				<Select.Viewport>
					{#each options as option (option.value)}
						<Select.Item
							value={option.value}
							label={option.label}
							disabled={option.disabled}
							class="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5
							       text-base text-foreground outline-none select-none
							       data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted"
						>
							{#snippet children({ selected })}
								<span class="truncate">{option.label}</span>
								{#if selected}
									<span class="shrink-0 text-2xs text-foreground-tertiary" aria-hidden="true"
										>✓</span
									>
								{/if}
							{/snippet}
						</Select.Item>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
{/snippet}

{#if wrapped}
	<Field {label} {hint} {error} {required} class={fieldClass}>
		{#snippet children({ id, invalid: fieldInvalid, describedBy })}
			{@render control(id, fieldInvalid, describedBy)}
		{/snippet}
	</Field>
{:else}
	{@render control(undefined, invalid, undefined)}
{/if}
