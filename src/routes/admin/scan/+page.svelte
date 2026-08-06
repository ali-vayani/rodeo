<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Html5Qrcode } from 'html5-qrcode';
	import { createClient } from '$lib/trpc/client';
	import ScanConfirmDialog from '$lib/components/admin/ScanConfirmDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	// --- Types ---
	interface LastScan {
		name: string;
		role: string;
		school: string;
	}

	interface ScanEntry {
		id: string;
		name: string;
		time: string;
		group: string;
	}

	type ScanState = 'idle' | 'success' | 'error' | 'duplicate';
	type LookupResult = Awaited<ReturnType<typeof trpc.scan.lookup.query>>;

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}

	function toScanEntry(scan: (typeof data.recentScans)[number]): ScanEntry {
		return {
			id: scan.id,
			name: scan.user.name,
			time: formatTime(new Date(scan.timestamp)),
			group: scan.action
		};
	}

	function roleLabel(role: string): string {
		return role.charAt(0) + role.slice(1).toLowerCase();
	}

	// --- State seeded from SSR load ---
	let scanActions = $state(untrack(() => [...data.scanActions]));
	let selectedAction = $state(untrack(() => data.scanActions[0] ?? 'Check-In'));
	let scanCounts = $state<Record<string, number>>(untrack(() => ({ ...data.scanCounts })));
	let recentScans = $state<ScanEntry[]>(untrack(() => data.recentScans.map(toScanEntry)));

	let manualInput = $state('');
	let scanState = $state<ScanState>('idle');
	let lastScan = $state<LastScan | null>(null);
	let errorMsg = $state('');
	let showManual = $state(false);

	// --- Camera ---
	let html5QrCode: Html5Qrcode | null = null;
	let cameraStarted = $state(false);
	let cameraError = $state('');

	// --- Lookup / confirm dialog ---
	let dialogOpen = $state(false);
	let dialogUser = $state<LookupResult | null>(null);
	let lookupLoading = $state(false);
	let isConfirming = $state(false);

	// --- Camera lifecycle ---
	onMount(async () => {
		try {
			html5QrCode = new Html5Qrcode('reader');
			await html5QrCode.start(
				{ facingMode: 'environment' },
				{
					fps: 5,
					qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
						const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.7);
						return { width: size, height: size };
					}
				},
				onScanSuccess,
				undefined
			);
			cameraStarted = true;
		} catch {
			cameraError = 'Camera unavailable — use manual entry below.';
			showManual = true;
		}
	});

	onDestroy(() => {
		if (html5QrCode && cameraStarted) {
			html5QrCode
				.stop()
				.then(() => html5QrCode?.clear())
				.catch(() => {});
		}
	});

	function onScanSuccess(decodedText: string) {
		if (!html5QrCode) return;
		// Must pause synchronously, before any await, or html5-qrcode keeps firing
		// this callback every frame while the code stays in view.
		html5QrCode.pause(true);
		handleDetected(decodedText);
	}

	function resumeScanning() {
		if (!html5QrCode || !cameraStarted) return;
		try {
			html5QrCode.resume();
		} catch {
			// already running — ignore
		}
	}

	// --- Lookup flow (shared by camera detection + manual entry) ---
	async function handleDetected(userCode: string) {
		const code = userCode.trim();
		if (!code || dialogOpen || lookupLoading) return;

		lookupLoading = true;
		manualInput = '';
		showManual = false;

		try {
			const result = await trpc.scan.lookup.query({ userCode: code, action: selectedAction });
			scanState = 'idle';
			dialogUser = result;
			dialogOpen = true;
		} catch (e) {
			scanState = 'error';
			errorMsg = errorMessage(e, 'No matching attendee found.');
			lastScan = null;
			resumeScanning();
		} finally {
			lookupLoading = false;
		}
	}

	async function handleManualLookup() {
		const email = manualInput.trim();
		if (!email || dialogOpen || lookupLoading) return;
		if (cameraStarted) html5QrCode?.pause(true);

		lookupLoading = true;
		manualInput = '';
		showManual = false;

		try {
			const result = await trpc.scan.lookupByEmail.query({ email, action: selectedAction });
			scanState = 'idle';
			dialogUser = result;
			dialogOpen = true;
		} catch (e) {
			scanState = 'error';
			errorMsg = errorMessage(e, 'No matching attendee found.');
			lastScan = null;
			resumeScanning();
		} finally {
			lookupLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleManualLookup();
	}

	function toggleManual() {
		showManual = !showManual;
		if (!showManual) manualInput = '';
	}

	// --- Confirm dialog actions ---
	async function confirmScan() {
		if (!dialogUser) return;
		isConfirming = true;
		try {
			const result = await trpc.scan.scanUser.mutate({
				userCode: dialogUser.user.uid,
				action: selectedAction
			});

			scanState = result.isDuplicate ? 'duplicate' : 'success';
			lastScan = {
				name: result.user.name,
				role: roleLabel(result.user.role),
				school: result.user.university ?? '—'
			};
			recentScans = [
				{
					id: result.scan.id,
					name: result.user.name,
					time: formatTime(new Date(result.scan.timestamp)),
					group: selectedAction
				},
				...recentScans
			].slice(0, 20);
			scanCounts[selectedAction] = (scanCounts[selectedAction] ?? 0) + 1;

			dialogOpen = false;
			dialogUser = null;
			// Camera stays paused until "Scan Next" is tapped.
		} catch (e) {
			scanState = 'error';
			errorMsg = errorMessage(e, 'Failed to record scan');
			lastScan = null;
			dialogOpen = false;
			dialogUser = null;
			resumeScanning();
		} finally {
			isConfirming = false;
		}
	}

	function cancelScan() {
		dialogOpen = false;
		dialogUser = null;
		resumeScanning();
	}

	function scanNext() {
		scanState = 'idle';
		lastScan = null;
		errorMsg = '';
		resumeScanning();
	}

	const totalScanned = $derived(Object.values(scanCounts).reduce((a, b) => a + b, 0));
</script>

<svelte:head>
	<title>Scan · Rodeo Admin</title>
</svelte:head>

<!-- Page header -->
<div class="mb-4 flex items-center justify-between">
	<div>
		<h1 class="text-[22px] font-bold text-primary">Scan</h1>
		<span class="mt-0.5 block text-[13px] text-muted-foreground">
			Scanning for <span class="font-medium text-primary">{selectedAction}</span>
		</span>
	</div>
	<span class="font-mono text-[11px] text-muted-foreground">
		{totalScanned} total {totalScanned === 1 ? 'scan' : 'scans'}
	</span>
</div>

<div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
	<!-- Scanner card -->
	<div class="overflow-hidden rounded-md border border-border bg-white">
		<!-- Scan action tabs -->
		<div class="flex items-stretch overflow-x-auto border-b border-border">
			{#each scanActions as action (action)}
				<button
					onclick={() => (selectedAction = action)}
					class="flex shrink-0 cursor-pointer items-center gap-2 border-b-2 bg-transparent px-4 py-[10px] text-[13px] whitespace-nowrap transition-colors {selectedAction ===
					action
						? 'border-b-primary font-semibold text-primary'
						: 'border-b-transparent font-normal text-muted-foreground hover:text-primary'}"
				>
					{action}
					<span
						class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
					>
						{scanCounts[action] ?? 0}
					</span>
				</button>
			{/each}
		</div>

		<div class="p-6">
			{#if cameraError}
				<div
					class="mb-4 rounded border border-[#fde68a] bg-[#fffbeb] px-[14px] py-3 text-[13px] leading-[1.5] text-[#92400e]"
				>
					{cameraError}
				</div>
			{/if}

			<!-- Viewfinder -->
			<div
				class="relative mx-auto flex aspect-square w-full max-w-[440px] items-center justify-center overflow-hidden rounded-md border bg-muted transition-colors {scanState ===
				'success'
					? 'border-primary'
					: 'border-border'}"
			>
				<div class="qr-reader-wrap absolute inset-0 z-0">
					<div id="reader"></div>
				</div>

				<!-- Guide overlay: corners + crosshair, always visible above the video -->
				<div
					class="absolute top-[10px] left-[10px] z-[1] h-4 w-4 rounded-tl-[2px] border-t-2 border-l-2 border-white/85 drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
				></div>
				<div
					class="absolute top-[10px] right-[10px] z-[1] h-4 w-4 rounded-tr-[2px] border-t-2 border-r-2 border-white/85 drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
				></div>
				<div
					class="absolute bottom-[10px] left-[10px] z-[1] h-4 w-4 rounded-bl-[2px] border-b-2 border-l-2 border-white/85 drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
				></div>
				<div
					class="absolute right-[10px] bottom-[10px] z-[1] h-4 w-4 rounded-br-[2px] border-r-2 border-b-2 border-white/85 drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
				></div>
				<div
					class="absolute top-1/2 right-[20%] left-[20%] z-[1] h-px bg-white/35 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
				></div>
				<div
					class="absolute top-[20%] bottom-[20%] left-1/2 z-[1] w-px bg-white/35 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
				></div>

				<!-- Status banner, anchored to the bottom edge so the camera stays visible -->
				<div
					class="absolute right-[10px] bottom-[10px] left-[10px] z-[2] rounded-md px-[14px] py-[10px] text-center backdrop-blur-[4px] transition-colors {scanState ===
					'success'
						? 'bg-primary/90'
						: scanState === 'duplicate'
							? 'border border-[#fde68a] bg-[#fffbeb]/95'
							: scanState === 'error'
								? 'border border-[#fecaca] bg-[#fee2e2]/95'
								: 'bg-white/90'}"
				>
					{#if lookupLoading}
						<span class="font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
							Looking up…
						</span>
					{:else if scanState === 'success'}
						<div
							class="mb-1 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-white"
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							Scan successful
						</div>
						<div class="text-[17px] leading-[1.2] font-bold tracking-[-0.01em] text-white">
							{lastScan?.name}
						</div>
						<div class="font-mono text-[11px] text-[#cccccc]">
							{lastScan?.role} · {lastScan?.school} · Checked in — {selectedAction}
						</div>
					{:else if scanState === 'duplicate'}
						<div
							class="mb-1 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-[#92400e]"
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path
									d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
								></path>
								<line x1="12" y1="9" x2="12" y2="13"></line>
								<line x1="12" y1="17" x2="12.01" y2="17"></line>
							</svg>
							Already scanned
						</div>
						<div class="text-[17px] leading-[1.2] font-bold tracking-[-0.01em] text-primary">
							{lastScan?.name}
						</div>
						<div class="font-mono text-[11px] text-[#92400e]">
							{lastScan?.role} · {lastScan?.school} · Duplicate — {selectedAction}
						</div>
					{:else if scanState === 'error'}
						<div
							class="mb-1 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-[#991b1b]"
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<circle cx="12" cy="12" r="10"></circle>
								<line x1="12" y1="8" x2="12" y2="12"></line>
								<line x1="12" y1="16" x2="12.01" y2="16"></line>
							</svg>
							Not found
						</div>
						<div class="font-mono text-[11px] text-[#991b1b]">{errorMsg}</div>
					{:else}
						<span class="font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
							Align QR code within frame
						</span>
					{/if}
				</div>
			</div>

			<!-- Scan next -->
			{#if scanState !== 'idle'}
				<button
					onclick={scanNext}
					class="mx-auto mt-4 flex w-full max-w-[440px] cursor-pointer items-center justify-center gap-2 rounded-md border border-primary bg-primary px-[18px] py-3 text-[13px] font-semibold text-white"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="1 4 1 10 7 10"></polyline>
						<path d="M3.51 15a9 9 0 1 0 .49-4.5"></path>
					</svg>
					Scan Next
				</button>
			{/if}

			<!-- Manual entry -->
			<div class="mx-auto mt-4 w-full max-w-[440px]">
				{#if !showManual}
					<button
						onclick={toggleManual}
						class="mx-auto block cursor-pointer bg-transparent py-1 font-mono text-[11px] text-muted-foreground underline underline-offset-[3px] transition-colors hover:text-primary"
					>
						Can't scan? Enter manually
					</button>
				{:else}
					<div class="overflow-hidden rounded-md border border-border">
						<div
							class="flex items-center justify-between border-b border-border bg-muted px-4 py-[9px]"
						>
							<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
								Manual Lookup
							</span>
							<button
								onclick={toggleManual}
								aria-label="Close manual lookup"
								class="flex cursor-pointer items-center rounded bg-transparent p-0.5 text-muted-foreground transition-colors hover:text-primary"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
						<div class="flex gap-2 p-3">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="flex-1 rounded border border-border bg-[#f9f9f9] px-[10px] py-2 text-[13px] text-primary outline-none"
								type="email"
								placeholder="Email address…"
								bind:value={manualInput}
								onkeydown={handleKeydown}
								autofocus
							/>
							<button
								onclick={handleManualLookup}
								disabled={!manualInput.trim()}
								class="shrink-0 cursor-pointer rounded-md border border-primary bg-primary px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
							>
								Look up
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Recent scans -->
	<div class="overflow-hidden rounded-md border border-border bg-white">
		<div class="flex items-center justify-between border-b border-border bg-muted px-4 py-[9px]">
			<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
				Recent Scans
			</span>
			{#if recentScans.length > 0}
				<span
					class="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
				>
					{recentScans.length}
				</span>
			{/if}
		</div>

		{#if recentScans.length === 0}
			<div class="px-4 py-8 text-center text-[13px] text-muted-foreground">
				No scans yet this session.
			</div>
		{:else}
			<div class="max-h-[calc(100vh-260px)] overflow-y-auto">
				{#each recentScans as scan (scan.id)}
					<div
						in:fly={{ y: -4, duration: 300 }}
						class="flex items-center gap-[10px] border-b border-[#f0f0f0] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#f5f5f5]"
					>
						<div
							class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white uppercase"
						>
							{scan.name[0]}
						</div>
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[13px] font-medium text-primary">{scan.name}</span>
							<span class="truncate font-mono text-[11px] text-muted-foreground">{scan.group}</span>
						</div>
						<span class="shrink-0 font-mono text-[11px] text-[#cccccc]">{scan.time}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<ScanConfirmDialog
	isOpen={dialogOpen}
	user={dialogUser?.user ?? null}
	action={selectedAction}
	isDuplicate={dialogUser?.isDuplicate ?? false}
	scanCountForAction={dialogUser?.scanCountForAction ?? 0}
	warning={dialogUser?.warning ?? null}
	{isConfirming}
	onConfirm={confirmScan}
	onCancel={cancelScan}
/>

<style>
	/* html5-qrcode owns the DOM inside #reader and sets width/height on it inline
	   once the camera starts — those inline styles beat any CSS written for #reader
	   itself, so the sizing is applied from this untouched wrapper instead. */
	.qr-reader-wrap :global(#reader) {
		width: 100% !important;
		height: 100% !important;
	}
	.qr-reader-wrap :global(video),
	.qr-reader-wrap :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		object-fit: cover;
		border-radius: inherit;
	}
</style>
