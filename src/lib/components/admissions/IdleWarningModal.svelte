<script lang="ts">
	import { IDLE_GRACE_MS } from '$lib/admissions/lock';

	let {
		applicantName,
		remainingLabel,
		remainingMs,
		onConfirm,
		onRelease
	}: {
		applicantName: string;
		remainingLabel: string;
		remainingMs: number;
		onConfirm: () => void;
		onRelease: () => void;
	} = $props();

	let confirmBtn = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		confirmBtn?.focus();
	});

	let progressPercent = $derived(Math.max(0, Math.min(100, (remainingMs / IDLE_GRACE_MS) * 100)));
</script>

<!-- No backdrop dismiss: as confirm, a stray click would silently renew the lock; as a
     no-op, it would hide a running countdown. Escape releases, which cannot renew by accident. -->
<div role="presentation" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45">
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="idle-title"
		aria-describedby="idle-desc"
		tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onRelease()}
		class="w-[440px] max-w-[calc(100vw-48px)] overflow-hidden rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
	>
		<div class="border-b border-border px-4 pt-5 pb-4 sm:px-6">
			<div id="idle-title" class="text-[16px] font-bold text-primary">Still reviewing?</div>
			<div id="idle-desc" class="mt-1 text-[13px] text-muted-foreground">
				You've been inactive for a couple of minutes.
			</div>
		</div>

		<div class="px-4 py-5 sm:px-6">
			<div class="mb-4 rounded border border-[#fde68a] bg-[#fffbeb] px-[14px] py-3">
				<div class="text-[13px] leading-[1.5] text-[#92400e]">
					Your review lock on <strong>{applicantName}</strong> will be released in
					<!-- aria-live off: a number announced every second is hostile to screen readers. -->
					<span class="font-mono font-semibold" aria-live="off">{remainingLabel}</span>
					so another admin can pick them up.
				</div>
				<div class="mt-2.5 h-[3px] overflow-hidden rounded bg-[#fde68a]">
					<div
						class="h-full bg-[#92400e] transition-[width] duration-1000 ease-linear"
						style="width:{progressPercent}%"
					></div>
				</div>
			</div>
			<div class="text-xs text-[#666]">Any decision you haven't submitted yet is not saved.</div>
		</div>

		<div class="flex flex-wrap justify-end gap-[10px] border-t border-border px-4 py-4 sm:px-6">
			<button
				onclick={onRelease}
				class="cursor-pointer rounded-md border border-border bg-white px-4 py-2 text-[13px] font-medium text-primary"
			>
				Release &amp; close
			</button>
			<button
				bind:this={confirmBtn}
				onclick={onConfirm}
				class="cursor-pointer rounded-md border border-primary bg-primary px-[18px] py-2 text-[13px] font-semibold text-white"
			>
				I'm still reviewing
			</button>
		</div>
	</div>
</div>
