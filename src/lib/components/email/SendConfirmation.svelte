<script module lang="ts">
	/** The parent gates its Send button on this. */
	export const CONFIRM_WORD = 'SEND';
</script>

<script lang="ts">
	import EmailPreview from './EmailPreview.svelte';

	let {
		subject,
		body,
		count,
		loading,
		sending,
		confirmText = $bindable()
	}: {
		subject: string;
		body: string;
		count: number | null;
		loading: boolean;
		sending: boolean;
		confirmText: string;
	} = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
	<div>
		<h2 class="text-[15px] font-semibold text-primary">Confirm &amp; Send</h2>
		<p class="mt-0.5 text-xs text-muted-foreground">
			This cannot be undone. Recipients are re-counted at this step, so the number below is current.
		</p>
	</div>

	<!-- Danger callout, matching the Release Decisions treatment -->
	<div class="rounded border border-[#fca5a5] bg-[#fff3f3] px-[14px] py-3">
		<div class="text-[13px] font-semibold text-primary">
			{#if loading}
				Counting recipients…
			{:else if count === null}
				Could not determine the recipient count.
			{:else}
				{count} user{count === 1 ? '' : 's'} will receive this email.
			{/if}
		</div>
		<div class="mt-1 text-xs text-muted-foreground">
			Subject: <span class="font-mono text-primary">{subject}</span>
		</div>
	</div>

	<EmailPreview {subject} {body} height="h-[220px]" />

	<div class="flex flex-col gap-2">
		<label for="send-confirm" class="text-xs text-muted-foreground">
			Type
			<span class="rounded bg-[#f0f0f0] px-[5px] py-px font-mono text-primary">{CONFIRM_WORD}</span>
			to confirm
		</label>
		<input
			id="send-confirm"
			bind:value={confirmText}
			disabled={sending}
			autocomplete="off"
			class="w-[220px] rounded border border-border bg-white px-3 py-[7px] font-mono text-[13px] text-primary outline-none focus:border-primary"
		/>
	</div>
</div>
