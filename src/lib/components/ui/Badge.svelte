<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import type { Tone } from '$lib/ui/tone';

	type Variant = 'subtle' | 'solid' | 'outline';

	let {
		tone = 'neutral',
		variant = 'subtle',
		dot = false,
		class: className = '',
		children
	}: {
		tone?: Tone;
		variant?: Variant;
		/** Leading status dot, for when the label alone doesn't scan fast enough. */
		dot?: boolean;
		class?: string;
		children: Snippet;
	} = $props();

	const BASE =
		'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 ' +
		'font-mono text-2xs font-medium tracking-eyebrow uppercase';

	// Written out rather than interpolated (`bg-${tone}-50`) because Tailwind
	// scans source text statically and never sees a constructed class name.
	const SUBTLE: Record<Tone, string> = {
		neutral: 'border-border bg-muted text-foreground-secondary',
		success: 'border-success-200 bg-success-50 text-success-700',
		warning: 'border-warning-200 bg-warning-50 text-warning-700',
		danger: 'border-danger-200 bg-danger-50 text-danger-700',
		info: 'border-info-200 bg-info-50 text-info-700'
	};

	const SOLID: Record<Tone, string> = {
		neutral: 'border-transparent bg-neutral-500 text-white',
		success: 'border-transparent bg-success-500 text-white',
		warning: 'border-transparent bg-warning-500 text-white',
		danger: 'border-transparent bg-danger-500 text-white',
		info: 'border-transparent bg-info-500 text-white'
	};

	const OUTLINE: Record<Tone, string> = {
		neutral: 'border-border bg-card text-foreground-secondary',
		success: 'border-success-200 bg-card text-success-700',
		warning: 'border-warning-200 bg-card text-warning-700',
		danger: 'border-danger-200 bg-card text-danger-700',
		info: 'border-info-200 bg-card text-info-700'
	};

	const DOT: Record<Tone, string> = {
		neutral: 'bg-neutral-400',
		success: 'bg-success-500',
		warning: 'bg-warning-500',
		danger: 'bg-danger-500',
		info: 'bg-info-500'
	};

	const TONES: Record<Variant, Record<Tone, string>> = {
		subtle: SUBTLE,
		solid: SOLID,
		outline: OUTLINE
	};
</script>

<span class={cn(BASE, TONES[variant][tone], className)}>
	{#if dot}
		<span
			class={cn('size-1.5 shrink-0 rounded-full', variant === 'solid' ? 'bg-current' : DOT[tone])}
		></span>
	{/if}
	{@render children()}
</span>
