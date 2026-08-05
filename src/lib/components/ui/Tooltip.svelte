<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tooltip } from 'bits-ui';

	let {
		content,
		side = 'top',
		delay = 200,
		children
	}: {
		content: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		delay?: number;
		children: Snippet;
	} = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root delayDuration={delay}>
		<Tooltip.Trigger class="cursor-default focus-visible:shadow-ring">
			{@render children()}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				{side}
				sideOffset={6}
				class="z-50 max-w-64 rounded-md bg-primary px-2 py-1 text-2xs text-primary-foreground shadow-md"
			>
				{content}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
