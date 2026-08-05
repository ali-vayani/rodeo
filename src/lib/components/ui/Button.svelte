<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import Spinner from './Spinner.svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
	type Size = 'sm' | 'md' | 'lg';

	let {
		variant = 'secondary',
		size = 'md',
		loading = false,
		disabled = false,
		href = undefined,
		type = 'button',
		class: className = '',
		children,
		...rest
	}: {
		variant?: Variant;
		size?: Size;
		/** Swaps the label for a spinner without changing width, so rows don't reflow. */
		loading?: boolean;
		disabled?: boolean;
		/** Renders an <a> instead of a <button>. */
		href?: string;
		type?: HTMLButtonAttributes['type'];
		class?: string;
		children: Snippet;
	} & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'type' | 'href' | 'class'> = $props();

	const BASE =
		'relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-md ' +
		'font-medium whitespace-nowrap transition-colors duration-150 ease-out-quick ' +
		'focus-visible:shadow-ring disabled:pointer-events-none disabled:opacity-50';

	const SIZES: Record<Size, string> = {
		sm: 'h-7 px-3 text-xs',
		md: 'h-8 px-4 text-base',
		lg: 'h-10 px-5 text-md'
	};

	const VARIANTS: Record<Variant, string> = {
		primary:
			'border border-transparent bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
		secondary:
			'border border-border bg-card text-foreground shadow-xs hover:bg-muted active:bg-neutral-100',
		ghost:
			'border border-transparent text-foreground-secondary hover:bg-muted hover:text-foreground',
		danger:
			'border border-transparent bg-destructive font-semibold text-destructive-foreground ' +
			'hover:bg-destructive-hover focus-visible:shadow-ring-danger'
	};

	const classes = $derived(cn(BASE, SIZES[size], VARIANTS[variant], className));
	const isDisabled = $derived(disabled || loading);
</script>

{#if href}
	<!-- A disabled link is not a thing, so it degrades to a non-interactive span. -->
	{#if isDisabled}
		<span class={cn(classes, 'pointer-events-none opacity-50')} aria-disabled="true">
			{@render children()}
		</span>
	{:else}
		<!--
			`href` arrives as an already-resolved string from the caller, which is
			the only place that knows the route. Resolving it here would mean this
			primitive had to know every route in the app.
		-->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a {href} class={classes} {...rest}>{@render children()}</a>
	{/if}
{:else}
	<button {type} disabled={isDisabled} class={classes} {...rest}>
		<!--
			The label stays in flow but goes invisible while loading, so the button
			keeps its exact width. Swapping the text for a spinner would resize the
			button mid-save and shift everything next to it.
		-->
		<span class={loading ? 'invisible' : 'contents'}>{@render children()}</span>
		{#if loading}
			<span class="absolute inset-0 flex items-center justify-center">
				<Spinner size={size === 'lg' ? 'md' : 'sm'} />
			</span>
		{/if}
	</button>
{/if}
