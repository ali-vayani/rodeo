<script lang="ts">
	import { untrack } from 'svelte';
	import { tokenizeTemplate, SAMPLE_VARS, type TemplateSegment } from '$lib/email/variables';

	let {
		subject,
		body,
		/** Values to substitute. Defaults to the placeholder samples. */
		vars = SAMPLE_VARS,
		/** Height of the scrollable preview box. */
		height = 'h-[180px]'
	}: {
		subject: string;
		body: string;
		vars?: Record<string, string>;
		height?: string;
	} = $props();

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
			class="rounded px-1 py-0.5 text-[12px] {seg.type === 'known'
				? 'bg-[#dbeafe] text-[#1d4ed8]'
				: 'bg-[#fef9c3] text-[#854d0e]'}">{seg.value}</span
		>{/if}{/snippet}

<div class="flex min-h-0 flex-col gap-2">
	<div class="flex items-center gap-2">
		<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Preview
		</span>
		{#if unknownKeys.length > 0}
			<span class="text-[11px] text-[#854d0e]">
				{unknownKeys.length}
				unknown variable{unknownKeys.length === 1 ? '' : 's'}: {unknownKeys
					.map((k) => `{{${k}}}`)
					.join(', ')} will send as-is
			</span>
		{/if}
	</div>

	<div class="{height} shrink-0 overflow-y-auto rounded border border-border bg-muted p-4">
		<div class="mb-2 border-b border-border pb-2 text-[13px] font-semibold text-primary">
			{#if debouncedSubject === ''}
				<span class="text-muted-foreground italic">No subject</span>
			{:else}<!--
				-->{#each subjectSegments as seg, i (i)}{@render part(seg)}{/each}{/if}
		</div>

		<div class="text-[13px] leading-relaxed whitespace-pre-wrap text-primary">
			{#if debouncedBody === ''}
				<span class="text-muted-foreground italic">Nothing to preview yet.</span>
			{:else}<!--
				-->{#each bodySegments as seg, i (i)}{@render part(seg)}{/each}{/if}
		</div>
	</div>
</div>
