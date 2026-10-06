<script module lang="ts">
	/**
	 * Whose substitution a preview is showing.
	 *
	 * Omitted by callers previewing a template rather than a message: the lifecycle editor
	 * has no concrete recipient, so it keeps the placeholder samples.
	 */
	export type PreviewAs = {
		uid?: string;
		name: string;
		email: string;
		/** No User row: `{{name}}` is the nameless-recipient fallback, not their name. */
		external: boolean;
		/** 0-based position among the sampled recipients. */
		index: number;
		/** Zero means nobody is selected yet, so `vars` are placeholders. */
		total: number;
		onNext: () => void;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import { tokenizeTemplate, SAMPLE_VARS, type TemplateSegment } from '$lib/email/variables';

	let {
		subject,
		body,
		/** Values to substitute. Defaults to the placeholder samples. */
		vars = SAMPLE_VARS,
		/** Height of the scrollable preview box. */
		height = 'md',
		/** Whose values `vars` are. Null previews a template, not a message. */
		previewAs = null
	}: {
		subject: string;
		body: string;
		vars?: Record<string, string>;
		height?: 'sm' | 'md' | 'lg';
		previewAs?: PreviewAs | null;
	} = $props();

	// Named sizes rather than a class string, so a caller cannot smuggle an
	// arbitrary height past the token rules.
	const HEIGHTS = { sm: 'h-36', md: 'h-44', lg: 'h-56' };

	// Debounced so the preview does not re-tokenize on every keystroke. Seeded from the
	// initial props; the $effect below carries every later change, and the parent remounts
	// this component on template switch.
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

	let checkIn = $state<{ html: string; filenames: string[] } | null>(null);
	let checkInError = $state('');
	let hasCheckIn = $derived(
		bodySegments.some(
			(segment) =>
				segment.type === 'known' && segment.key === 'hacker_qr_code' && segment.value !== ''
		)
	);

	$effect(() => {
		const uid = previewAs?.uid;
		const needed = hasCheckIn;
		let cancelled = false;
		checkIn = null;
		checkInError = '';
		if (needed) {
			createClient()
				.email.previewCheckIn.query({ uid })
				.then(
					(result) => {
						if (!cancelled) checkIn = result;
					},
					() => {
						if (!cancelled) checkInError = 'Could not load the QR attachment preview.';
					}
				);
		}
		return () => {
			cancelled = true;
		};
	});

	let unknownKeys = $derived([
		...new Set(
			[...subjectSegments, ...bodySegments]
				.filter((s) => s.type === 'unknown')
				.map((s) => (s.type === 'unknown' ? s.key : ''))
		)
	]);
</script>

<!--
	The segment loops below are kept on a single line on purpose: the body renders as
	whitespace-pre-wrap, so a newline between {#each} and its content risks showing up as
	spacing the real email does not have.
-->
<!--
	An empty known value renders nothing at all — a variable that substitutes to ''
	for this recipient (e.g. the QR block for someone who won't get one) must not
	leave an empty highlight pill the real email doesn't have.
-->
{#snippet part(
	seg: TemplateSegment,
	includeAttachments = false
)}{#if seg.type === 'text'}{seg.value}{:else if seg.value === ''}{:else if seg.type === 'known' && seg.key === 'hacker_qr_code'}{#if includeAttachments}{#if checkInError}<span
					class="text-sm text-warning-700">{checkInError}</span
				>{:else if checkIn && !checkIn.html}<span class="text-xs text-foreground-secondary"
					>This recipient receives no QR attachment.</span
				>{:else if checkIn}<iframe
					title="Check-in QR attachment preview"
					srcdoc={checkIn.html}
					sandbox=""
					class="h-96 w-full border-0 bg-white"
				></iframe><span class="text-xs text-foreground-secondary"
					>Inline attachment: {checkIn.filenames.join(', ')}{#if !previewAs?.uid}. Sample only; each
						attendee receives their own QR code.{/if}</span
				>{:else}<span class="text-sm text-foreground-secondary">Loading QR attachment...</span
				>{/if}{/if}{:else}<span
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

	{#if previewAs}
		<!-- Who this is rendered for. Wraps rather than scrolls: at 320px the address
		     and the pager both have to stay on screen. -->
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-secondary">
			{#if previewAs.total === 0}
				<span>No recipients selected — showing placeholder values.</span>
			{:else}
				<span class="min-w-0">
					Previewing as
					<span class="font-semibold text-foreground">{previewAs.name}</span>
					<span class="font-mono break-all text-foreground">{previewAs.email}</span>
				</span>
				{#if previewAs.external}
					<span
						class="rounded-sm border border-info-200 bg-info-50 px-1.5 py-0.5 font-mono text-2xs tracking-eyebrow text-info-700 uppercase"
					>
						No account
					</span>
				{/if}
				{#if previewAs.total > 1}
					<span class="font-mono text-2xs text-foreground-tertiary">
						{previewAs.index + 1} of {previewAs.total}
					</span>
					<button
						type="button"
						onclick={previewAs.onNext}
						class="cursor-pointer border-none bg-transparent p-0 text-xs text-foreground underline underline-offset-2 hover:opacity-70 focus-visible:shadow-ring"
					>
						Next recipient →
					</button>
				{/if}
			{/if}
		</div>
	{/if}

	<div
		class="{HEIGHTS[height]} shrink-0 overflow-y-auto rounded-md border border-border bg-muted p-4"
	>
		<div
			class="mb-2 border-b border-border pb-2 text-base font-semibold break-words text-foreground"
		>
			{#if debouncedSubject === ''}
				<span class="text-foreground-secondary italic">No subject</span>
			{:else}<!--
				-->{#each subjectSegments as seg, i (i)}{@render part(seg)}{/each}{/if}
		</div>

		<div
			class="max-w-full text-base leading-relaxed break-words whitespace-pre-wrap text-foreground"
		>
			{#if debouncedBody === ''}
				<span class="text-foreground-secondary italic">Nothing to preview yet.</span>
			{:else}<!--
				-->{#each bodySegments as seg, i (i)}{@render part(seg, true)}{/each}{/if}
		</div>
	</div>
</div>
