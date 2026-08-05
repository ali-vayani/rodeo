<script lang="ts">
	import { cn } from '$lib/utils';
	import Eyebrow from '$lib/components/ui/Eyebrow.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';

	let {
		title,
		options,
		selected = $bindable([]),
		class: className = ''
	}: {
		title: string;
		options: { value: string; label: string }[];
		selected?: string[];
		class?: string;
	} = $props();

	function toggle(value: string) {
		selected = selected.includes(value)
			? selected.filter((item) => item !== value)
			: [...selected, value];
	}
</script>

<!--
	UserFilters and RecipientFilter were the same checkbox-group-with-clear
	built twice, with different label styling and different clear affordances.
-->
<div class={cn('flex flex-col gap-2', className)}>
	<div class="flex items-baseline justify-between gap-2">
		<Eyebrow>{title}</Eyebrow>
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

	<div class="flex flex-col gap-1.5">
		{#each options as option (option.value)}
			<Checkbox
				checked={selected.includes(option.value)}
				label={option.label}
				onCheckedChange={() => toggle(option.value)}
			/>
		{/each}
	</div>
</div>
