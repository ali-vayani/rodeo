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

<div class="rounded border bg-white p-6" style="border-color: #e0e0e0">
	<p class="mb-4 text-xs font-medium uppercase tracking-widest" style="color: #aaaaaa">
		CHECK-IN QR CODE
	</p>

	<div class="mb-4 flex justify-center">
		{#if qrDataUrl}
			<img src={qrDataUrl} alt="Check-in QR code" class="h-[200px] w-[200px]" />
		{:else}
			<div class="h-[200px] w-[200px]" style="background: #f4f4f4"></div>
		{/if}
	</div>

	<div class="mb-1 text-center">
		<span class="font-mono text-sm font-semibold" style="color: #191919">{displayCode}</span>
	</div>
	<p class="mb-5 text-center text-xs" style="color: #aaaaaa">Show at check-in</p>

	<button
		type="button"
		onclick={downloadQR}
		disabled={!qrDataUrl}
		class="w-full rounded border px-4 py-2 text-sm transition-colors hover:bg-[#f4f4f4] disabled:opacity-40"
		style="border-color: #e0e0e0; color: #191919"
	>
		Download PDF
	</button>
</div>
