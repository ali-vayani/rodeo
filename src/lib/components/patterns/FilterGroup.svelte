<script lang="ts">
	import { cn } from '$lib/utils';
	import Eyebrow from '$lib/components/ui/Eyebrow.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';

	let {
		title,
		options,
		selected = $bindable([]),
		collapsible = true,
		open = $bindable(true),
		class: className = ''
	}: {
		title: string;
		options: { value: string; label: string }[];
		selected?: string[];
		/** Fold the options away behind the title. The header stays put either way. */
		collapsible?: boolean;
		/**
		 * Whether the options are showing. Bindable, and open on arrival at every
		 * width: collapsing is something the reader asks for, never a default that
		 * hides a filter they have not seen yet.
		 */
		open?: boolean;
		class?: string;
	} = $props();

	const panelId = $props.id();

	function toggle(value: string) {
		selected = selected.includes(value)
			? selected.filter((item) => item !== value)
			: [...selected, value];
	}
</script>

<div class={cn('flex flex-col gap-2', className)}>
	<div class="flex items-baseline justify-between gap-2">
		{#if collapsible}
			<button
				type="button"
				onclick={() => (open = !open)}
				aria-expanded={open}
				aria-controls={panelId}
				class="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-none
				       bg-transparent p-0 text-left focus-visible:shadow-ring"
			>
				<span
					aria-hidden="true"
					class="inline-block text-md leading-none text-foreground-tertiary transition-transform
					       duration-150 ease-out-quick {open ? '' : '-rotate-90'}"
				>
					▾
				</span>
				<Eyebrow as="span">{title}</Eyebrow>
				<!--
					A group folded shut is still filtering. The count is the only thing on
					screen that says so, so it lives in the header and not in the panel.
				-->
				{#if selected.length}
					<span
						class="rounded-sm bg-primary px-1 font-mono text-2xs text-primary-foreground tabular-nums"
					>
						{selected.length}
					</span>
				{/if}
			</button>
		{:else}
			<Eyebrow>{title}</Eyebrow>
		{/if}

		{#if selected.length}
			<button
				type="button"
				onclick={() => (selected = [])}
				class="cursor-pointer border-none bg-transparent p-0 text-2xs text-foreground-tertiary
				       underline transition-colors hover:text-foreground focus-visible:shadow-ring"
			>
				Clear
			</button>
		{/if}
	</div>

	{#if open}
		<div id={panelId} class="flex flex-col gap-1.5">
			{#each options as option (option.value)}
				<Checkbox
					checked={selected.includes(option.value)}
					label={option.label}
					onCheckedChange={() => toggle(option.value)}
				/>
			{/each}
		</div>
	{/if}
</div>
