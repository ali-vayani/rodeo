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
		/**
		 * Receives the trigger props to spread onto your own element:
		 *
		 *     <Tooltip content="Remove">
		 *       {#snippet children(props)}
		 *         <IconButton label="Remove" {...props}>✕</IconButton>
		 *       {/snippet}
		 *     </Tooltip>
		 */
		children: Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<!--
	The trigger renders through bits-ui's `child` snippet rather than as its own element.
	Left to itself Tooltip.Trigger emits a <button>, so wrapping an IconButton nested a
	button inside a button, which the browser silently repairs while tripping a hydration
	mismatch. Handing the props to the caller's element keeps aria-describedby on the
	real control.
-->
<Tooltip.Provider>
	<Tooltip.Root delayDuration={delay}>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render children(props)}
			{/snippet}
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
