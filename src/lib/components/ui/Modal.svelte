<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { cn } from '$lib/utils';

	type Size = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

	let {
		open = $bindable(false),
		title,
		description = undefined,
		size = 'md',
		dismissible = true,
		class: className = '',
		bodyClass = '',
		onClose = undefined,
		footer,
		children
	}: {
		open?: boolean;
		title: string;
		description?: string;
		size?: Size;
		/** false blocks Escape and backdrop-close — for a destructive step mid-flight. */
		dismissible?: boolean;
		class?: string;
		bodyClass?: string;
		/**
		 * Fires on any dismissal — Escape, backdrop, or the close button. Needed
		 * when the caller keeps its own "which row am I editing" state, which
		 * would otherwise stay set after the dialog went away.
		 */
		onClose?: () => void;
		footer?: Snippet;
		children: Snippet;
	} = $props();

	function onOpenChange(next: boolean) {
		if (!next) onClose?.();
	}

	const SIZES: Record<Size, string> = {
		sm: 'max-w-modal-sm',
		md: 'max-w-modal-md',
		lg: 'max-w-modal-lg',
		xl: 'max-w-modal-xl',
		'2xl': 'max-w-modal-2xl'
	};
</script>

<!-- bits-ui Dialog supplies the focus trap, focus restore, scroll lock, Escape and ARIA. -->
<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-0 z-50 bg-overlay"
		/>

		<Dialog.Content
			class={cn(
				'fixed top-1/2 left-1/2 z-50 flex modal-panel-w -translate-x-1/2 -translate-y-1/2',
				'flex-col overflow-hidden rounded-xl bg-card shadow-lg',
				SIZES[size],
				className
			)}
			escapeKeydownBehavior={dismissible ? 'close' : 'ignore'}
			interactOutsideBehavior={dismissible ? 'close' : 'ignore'}
		>
			<div class="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
				<div class="min-w-0">
					<Dialog.Title class="m-0 text-xl font-semibold text-foreground">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="mt-0.5 mb-0 text-xs text-foreground-secondary">
							{description}
						</Dialog.Description>
					{/if}
				</div>

				{#if dismissible}
					<Dialog.Close
						class="-mt-1 -mr-2 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center
						       rounded-md border-none bg-transparent text-lg leading-none text-foreground-tertiary
						       transition-colors duration-150 hover:bg-muted hover:text-foreground
						       focus-visible:shadow-ring"
						aria-label="Close"
					>
						✕
					</Dialog.Close>
				{/if}
			</div>

			<div class={cn('panel-scroll px-6 py-5', bodyClass)}>
				{@render children()}
			</div>

			{#if footer}
				<div class="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
