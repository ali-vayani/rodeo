<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	type Variant = 'ghost' | 'secondary' | 'danger';

	let {
		label,
		variant = 'ghost',
		size = 'md',
		disabled = false,
		type = 'button',
		class: className = '',
		children,
		...rest
	}: {
		/** Required — an icon-only control has no accessible name without it. */
		label: string;
		variant?: Variant;
		size?: 'sm' | 'md';
		disabled?: boolean;
		type?: HTMLButtonAttributes['type'];
		class?: string;
		children: Snippet;
	} & Omit<HTMLButtonAttributes, 'type' | 'class' | 'aria-label'> = $props();

	const SIZES = { sm: 'size-7 text-base', md: 'size-8 text-md' };

	const VARIANTS: Record<Variant, string> = {
		ghost:
			'border-transparent bg-transparent text-foreground-tertiary hover:bg-muted hover:text-foreground',
		secondary: 'border-border bg-card text-foreground shadow-xs hover:bg-muted',
		danger:
			'border-transparent bg-transparent text-foreground-tertiary hover:bg-danger-50 hover:text-danger-700 focus-visible:shadow-ring-danger'
	};
</script>

<button
	{type}
	{disabled}
	aria-label={label}
	title={label}
	class={cn(
		'inline-flex cursor-pointer items-center justify-center rounded-md border leading-none',
		'transition-colors duration-150 ease-out-quick focus-visible:shadow-ring',
		'disabled:pointer-events-none disabled:opacity-50',
		SIZES[size],
		VARIANTS[variant],
		className
	)}
	{...rest}
>
	{@render children()}
</button>
