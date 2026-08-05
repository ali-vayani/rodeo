<script lang="ts">
	import { untrack } from 'svelte';
	import { tokenizeTemplate, SAMPLE_VARS, type TemplateSegment } from '$lib/email/variables';

	let {
		subject,
		body,
		/** Values to substitute. Defaults to the placeholder samples. */
		vars = SAMPLE_VARS,
		/** Height of the scrollable preview box. */
		height = 'md'
	}: {
		subject: string;
		body: string;
		vars?: Record<string, string>;
		height?: 'sm' | 'md' | 'lg';
	} = $props();

	// Named sizes rather than a class string, so a caller cannot smuggle an
	// arbitrary height past the token rules.
	const HEIGHTS = { sm: 'h-36', md: 'h-44', lg: 'h-56' };

	// Debounced so the preview doesn't re-tokenize on every keystroke. Seeded from
	// the initial props deliberately; the $effect below carries every later change.
	// The parent remounts this component on template switch so the seed stays fresh.
	let debouncedSubject = $state(untrack(() => subject));
	let debouncedBody = $state(untrack(() => body));

	$effect(() => {
		const s = subject;
		const b = body;
		const timer = setTimeout(() => {
			debouncedSubject = s;
			debouncedBody = b;
		}, 300);
		return () => clearTimeout(timer);
	});

	let subjectSegments = $derived(tokenizeTemplate(debouncedSubject, vars));
	let bodySegments = $derived(tokenizeTemplate(debouncedBody, vars));

	let unknownKeys = $derived([
		...new Set(
			[...subjectSegments, ...bodySegments]
				.filter((s) => s.type === 'unknown')
				.map((s) => (s.type === 'unknown' ? s.key : ''))
		)
	]);
</script>

<!--
	The segment loops below are kept on a single line on purpose: the body renders
	as whitespace-pre-wrap, so any newline between {#each} and its content risks
	showing up as spacing the real email doesn't have.
-->
{#snippet part(seg: TemplateSegment)}{#if seg.type === 'text'}{seg.value}{:else}<span
			class="rounded-md px-1 py-0.5 text-sm {seg.type === 'known'
				? 'bg-info-50 text-info-700'
				: 'bg-warning-50 text-warning-700'}">{seg.value}</span
		>{/if}{/snippet}

<div class="flex min-h-0 flex-col gap-2">
	<div class="flex items-center gap-2">
		<span
			class="font-mono text-2xs font-medium tracking-eyebrow text-foreground-tertiary uppercase"
		>
			Preview
		</span>
		{#if unknownKeys.length > 0}
			<span class="text-xs text-warning-700">
				{unknownKeys.length}
				unknown variable{unknownKeys.length === 1 ? '' : 's'}: {unknownKeys
					.map((k) => `{{${k}}}`)
					.join(', ')} will send as-is
			</span>
		{/if}
	</div>

	<div
		class="{HEIGHTS[height]} shrink-0 overflow-y-auto rounded-md border border-border bg-muted p-4"
	>
		<div class="mb-2 border-b border-border pb-2 text-base font-semibold text-foreground">
			{#if debouncedSubject === ''}
				<span class="text-foreground-secondary italic">No subject</span>
			{:else}<!--
				-->{#each subjectSegments as seg, i (i)}{@render part(seg)}{/each}{/if}
		</div>

		<div class="text-base leading-relaxed whitespace-pre-wrap text-foreground">
			{#if debouncedBody === ''}
				<span class="text-foreground-secondary italic">Nothing to preview yet.</span>
			{:else}<!--
				-->{#each bodySegments as seg, i (i)}{@render part(seg)}{/each}{/if}
		</div>
	</div>
</div>
