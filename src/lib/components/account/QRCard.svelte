<script lang="ts">
	import QRCode from 'qrcode';

	interface Props {
		uid: string;
	}

	let { uid }: Props = $props();

	// Derive a short display code from the uid
	const displayCode = $derived('RC-' + uid.slice(-4).toUpperCase());

	let qrDataUrl = $state('');

	$effect(() => {
		QRCode.toDataURL(uid, {
			width: 200,
			margin: 1,
			color: { dark: '#191919', light: '#ffffff' }
		}).then((url) => {
			qrDataUrl = url;
		});
	});

	function downloadQR() {
		const a = document.createElement('a');
		a.href = qrDataUrl;
		a.download = `${displayCode}.png`;
		a.click();
	}
</script>

<div class=" bg-card shadow-float">
	<div
		class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line-subtle
		 px-6 py-4"
	>
		<h2 class="text-lg font-bold text-foreground">Check-in code</h2>
		<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			Scan at the door
		</span>
	</div>

	<div class="px-6 py-6">
		<div class="flex justify-center">
			{#if qrDataUrl}
				<img src={qrDataUrl} alt="Check-in QR code" class="size-50" />
			{:else}
				<div class="size-50 animate-pulse bg-muted"></div>
			{/if}
		</div>

		<p class="mt-4 text-center font-mono text-md font-medium text-foreground">{displayCode}</p>

		<button
			type="button"
			onclick={downloadQR}
			disabled={!qrDataUrl}
			class="mt-5 w-full cursor-pointer border border-border px-4 py-2.5 font-display
			 text-md font-semibold text-foreground transition-colors duration-150
			 hover:border-brand-ink focus-visible:shadow-ring disabled:cursor-not-allowed
			 disabled:opacity-40"
		>
			Download code
		</button>
	</div>
</div>
