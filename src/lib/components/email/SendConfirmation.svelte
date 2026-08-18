<script module lang="ts">
	/** The parent gates its Send button on this. */
	export const CONFIRM_WORD = 'SEND';
</script>

<script lang="ts">
	import EmailPreview, { type PreviewAs } from './EmailPreview.svelte';
	import { Input } from '$lib/components/ui';

	let {
		subject,
		body,
		count,
		/** How many of `count` have no portal account. Called out explicitly below. */
		externalCount = 0,
		loading,
		sending,
		vars = undefined,
		previewAs = null,
		confirmText = $bindable()
	}: {
		subject: string;
		body: string;
		count: number | null;
		externalCount?: number;
		loading: boolean;
		sending: boolean;
		vars?: Record<string, string>;
		previewAs?: PreviewAs | null;
		confirmText: string;
	} = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
	<div>
		<h2 class="text-lg font-semibold text-foreground">Confirm &amp; Send</h2>
		<p class="mt-0.5 text-xs text-foreground-secondary">
			This cannot be undone. Recipients are re-counted at this step, so the number below is current.
		</p>
	</div>

	<!-- Danger callout, matching the Release Decisions treatment -->
	<div class="rounded-md border border-danger-200 bg-danger-50 px-3.5 py-3">
		<div class="text-base font-semibold text-foreground">
			{#if loading}
				Counting recipients…
			{:else if count === null}
				Could not determine the recipient count.
			{:else if externalCount > 0}
				{count} recipient{count === 1 ? '' : 's'} will receive this email.
			{:else}
				{count} user{count === 1 ? '' : 's'} will receive this email.
			{/if}
		</div>
		{#if externalCount > 0}
			<div class="mt-1 text-xs font-semibold text-destructive">
				{externalCount} of them {externalCount === 1 ? 'is an address' : 'are addresses'} with no portal
				account — this email leaves the portal.
			</div>
		{/if}
		<div class="mt-1 text-xs text-foreground-secondary">
			Subject: <span class="font-mono text-foreground">{subject}</span>
		</div>
	</div>

	<EmailPreview {subject} {body} {vars} {previewAs} height="lg" />

	<Input
		bind:value={confirmText}
		label="Type {CONFIRM_WORD} to confirm"
		mono
		autocomplete="off"
		disabled={sending}
		placeholder={CONFIRM_WORD}
		class="max-w-56"
		fieldClass="max-w-56"
	/>
</div>
