<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
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
    return { name: scan.user.name, time: formatTime(new Date(scan.timestamp)), group: scan.action };
  }

  function primaryRole(roles: string[]): string {
    if (!roles.length) return 'Attendee';
    const r = roles[0];
    return r.charAt(0) + r.slice(1).toLowerCase();
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
    } catch (e: any) {
      scanState = 'error';
      errorMsg = e.message ?? 'No matching attendee found.';
      lastScan = null;
      resumeScanning();
    } finally {
      lookupLoading = false;
    }
  }

  function handleManualLookup() {
    if (cameraStarted) html5QrCode?.pause(true);
    handleDetected(manualInput);
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
        role: primaryRole(result.user.roles),
        school: result.user.university ?? '—'
      };
      recentScans = [
        { name: result.user.name, time: formatTime(new Date(result.scan.timestamp)), group: selectedAction },
        ...recentScans
      ].slice(0, 20);
      scanCounts[selectedAction] = (scanCounts[selectedAction] ?? 0) + 1;

      dialogOpen = false;
      dialogUser = null;
      // Camera stays paused until "Scan Next" is tapped.
    } catch (e: any) {
      scanState = 'error';
      errorMsg = e.message ?? 'Failed to record scan';
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
  <title>RODEO — Admin Scan</title>
  <link
    href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="page">

  <!-- ── Top bar ── -->
  <header class="topbar">
    <div class="topbar-left">
      <span class="topbar-label">Admin Scan</span>
    </div>
   
  </header>

  <main class="content">

    <!-- ── Group selector ── -->
    <section class="section">
      <label class="field-label" for="group-select">Scan Action</label>
      <div class="select-wrap">
        <select id="group-select" class="group-select" bind:value={selectedAction}>
          {#each scanActions as action (action)}
            <option value={action}>{action}</option>
          {/each}
        </select>
        <svg class="select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </section>

    {#if cameraError}
      <section class="section" style="padding-top: 0; padding-bottom: 8px;">
        <div class="camera-error-banner">{cameraError}</div>
      </section>
    {/if}

    <!-- ── Viewfinder ── -->
    <section class="viewfinder-section">
      <div
        class="viewfinder"
        class:vf-success={scanState === 'success'}
        class:vf-error={scanState === 'error' || scanState === 'duplicate'}
      >
        <div class="qr-reader-wrap">
          <div id="reader"></div>
        </div>

        <!-- Guide overlay: corners + crosshair, always visible above the video -->
        <div class="corner tl"></div>
        <div class="corner tr"></div>
        <div class="corner bl"></div>
        <div class="corner br"></div>
        <div class="guide-line guide-h"></div>
        <div class="guide-line guide-v"></div>

        <!-- Status banner, anchored to the bottom edge so the camera stays visible -->
        <div class="vf-banner" class:vf-banner-success={scanState === 'success'} class:vf-banner-warn={scanState === 'duplicate'} class:vf-banner-err={scanState === 'error'}>
          {#if lookupLoading}
            <span class="vf-hint">Looking up…</span>

          {:else if scanState === 'success'}
            <div class="vf-status-row success">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Scan successful
            </div>
            <div class="vf-name">{lastScan?.name}</div>
            <div class="vf-meta">{lastScan?.role} · {lastScan?.school} · Checked in — {selectedAction}</div>

          {:else if scanState === 'duplicate'}
            <div class="vf-status-row warn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Already scanned
            </div>
            <div class="vf-name">{lastScan?.name}</div>
            <div class="vf-meta">{lastScan?.role} · {lastScan?.school} · Duplicate — {selectedAction}</div>

          {:else if scanState === 'error'}
            <div class="vf-status-row err">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              Not found
            </div>
            <div class="vf-meta">{errorMsg}</div>

          {:else}
            <span class="vf-hint">Align QR code within frame</span>
          {/if}
        </div>
      </div>
    </section>

    <!-- ── Scan next button ── -->
    {#if scanState !== 'idle'}
      <section class="section">
        <button class="btn-primary" onclick={scanNext}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 .49-4.5"></path>
          </svg>
          Scan Next
        </button>
      </section>
    {/if}

    <!-- ── Manual entry ── -->
    <section class="manual-section">
      {#if !showManual}
        <button class="manual-toggle" onclick={toggleManual}>
          Can't scan? Enter manually
        </button>
      {:else}
        <div class="manual-box">
          <div class="manual-header">
            <span class="field-label" style="margin:0;">Manual Lookup</span>
            <button class="manual-close" onclick={toggleManual}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="manual-row">
            <input
              class="manual-input"
              type="text"
              placeholder="User ID or RC- code…"
              bind:value={manualInput}
              onkeydown={handleKeydown}
              autofocus
            />
            <button class="manual-go" onclick={handleManualLookup} disabled={!manualInput.trim()}>
              Look up
            </button>
          </div>
        </div>
      {/if}
    </section>

    <!-- ── Divider ── -->
    <div class="divider"></div>

    <!-- ── Recent scans ── -->
    <section class="section">
      <div class="section-header-row">
        <span class="field-label" style="margin:0;">Recent Scans</span>
        {#if recentScans.length > 0}
          <span class="count-pill">{recentScans.length}</span>
        {/if}
      </div>

      {#if recentScans.length === 0}
        <p class="empty-state">No scans yet this session.</p>
      {:else}
        <ul class="recent-list">
          {#each recentScans as scan , i (i)}
            <li class="recent-row" class:recent-row-new={i === 0 && scanState === 'success'}>
              <div class="recent-avatar">{scan.name[0]}</div>
              <div class="recent-info">
                <span class="recent-name">{scan.name}</span>
                <span class="recent-group">{scan.group}</span>
              </div>
              <span class="recent-time">{scan.time}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  </main>

  <!-- ── Stats footer ── -->
<footer class="stats-footer">
  {#each scanActions as action (action)}
    <button class="stat-chip" class:stat-chip-active={action === selectedAction} onclick={() => selectedAction = action}>
      <span class="stat-chip-name">{action}</span>
      <span class="stat-chip-count">{scanCounts[action] ?? 0}</span>
    </button>
  {/each}
</footer>
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
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :global(body) {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f4f4f4;
    color: #191919;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Layout ── */
  .page {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    max-width: 480px;
    margin: 0 auto;
    background: #f4f4f4;
  }

  /* ── Top bar ── */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #191919;
    color: #fff;
    padding: 0 16px;
    height: 48px;
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .topbar-brand {
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    color: #fff;
  }
  .topbar-divider {
    color: #555;
    font-size: 0.85rem;
    font-weight: 300;
  }
  .topbar-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #aaa;
  }
  .topbar-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    color: #6ee7b7;
    background: rgba(110,231,183,0.1);
    border: 1px solid rgba(110,231,183,0.2);
    border-radius: 20px;
    padding: 3px 10px;
  }
  .topbar-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6ee7b7;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── Content ── */
  .content {
    flex: 1;
    padding: 0 14px 40px;
  }

  .section {
    padding: 14px 0;
  }

  .field-label {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    color: #888;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: block;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  /* ── Group select ── */
  .select-wrap {
    position: relative;
  }
  .group-select {
    font-family: 'Inter', sans-serif;
    font-size: 0.875rem;
    font-weight: 500;
    width: 100%;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 10px 36px 10px 12px;
    background: #fff;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    outline: none;
    color: #191919;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .group-select:focus {
    border-color: #191919;
    box-shadow: 0 0 0 2px rgba(25,25,25,0.07);
  }
  .select-chevron {
    position: absolute;
    right: 11px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: #888;
  }

  /* ── Stats panel ── */
  .stats-section {
    padding: 0 0 14px;
  }
  .stats-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    color: #191919;
    transition: background 0.1s;
  }
  .stats-toggle:hover {
    background: #f9f9f9;
  }
  .stats-toggle-left {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #444;
  }
  .stats-toggle-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stats-total-badge {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    color: #888;
    background: #f4f4f4;
    border: 1px solid #e0e0e0;
    border-radius: 20px;
    padding: 2px 8px;
  }
  .stats-chevron {
    color: #888;
    transition: transform 0.2s;
  }
  .stats-chevron.open {
    transform: rotate(180deg);
  }
  .stats-panel {
    border: 1px solid #e0e0e0;
    border-top: none;
    border-radius: 0 0 8px 8px;
    background: #fff;
    overflow: hidden;
  }
  .stat-row {
    padding: 10px 12px 8px;
    border-bottom: 1px solid #f0f0f0;
    transition: background 0.1s;
  }
  .stat-row:last-child {
    border-bottom: none;
  }
  .stat-row-active {
    background: #fafafa;
  }
  .stat-row-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .stat-name {
    font-size: 0.82rem;
    font-weight: 500;
    color: #191919;
  }
  .stat-row-active .stat-name {
    font-weight: 600;
  }
  .stat-count {
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
  }
  .stat-count-num {
    color: #191919;
    font-weight: 500;
  }
  .stat-count-total {
    color: #bbb;
  }
  .stat-bar-track {
    height: 3px;
    background: #f0f0f0;
    border-radius: 2px;
    overflow: hidden;
  }
  .stat-bar-fill {
    height: 100%;
    background: #191919;
    border-radius: 2px;
    transition: width 0.4s ease;
  }
  .stat-row-active .stat-bar-fill {
    background: #191919;
  }

  /* ── Viewfinder ── */
  .viewfinder-section {
    padding: 0 0 0;
  }
  .viewfinder {
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    position: relative;
    background: #fff;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .viewfinder.vf-success {
    border-color: #191919;
    box-shadow: 0 0 0 2px rgba(25,25,25,0.07);
  }
  .viewfinder.vf-error {
    border-color: #e0e0e0;
  }

  /* Camera video feed. html5-qrcode is given the inner #reader div and sets
     position/width/height on it via inline styles once it starts — those
     inline styles beat any CSS we write for #reader itself, so absolute
     positioning is applied to this untouched wrapper instead. */
  .qr-reader-wrap {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
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

  .camera-error-banner {
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
    color: #92400e;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    padding: 8px 12px;
  }

  /* Corner brackets — layered above the video feed */
  .corner {
    position: absolute;
    z-index: 1;
    width: 16px;
    height: 16px;
    border-color: rgba(255,255,255,0.85);
    border-style: solid;
    filter: drop-shadow(0 0 2px rgba(0,0,0,0.45));
  }
  .corner.tl { top: 10px;    left: 10px;    border-width: 2px 0 0 2px; border-radius: 2px 0 0 0; }
  .corner.tr { top: 10px;    right: 10px;   border-width: 2px 2px 0 0; border-radius: 0 2px 0 0; }
  .corner.bl { bottom: 10px; left: 10px;    border-width: 0 0 2px 2px; border-radius: 0 0 0 2px; }
  .corner.br { bottom: 10px; right: 10px;   border-width: 0 2px 2px 0; border-radius: 0 0 2px 0; }

  /* Guide crosshair — thin lines through the center, layered above the video feed */
  .guide-line {
    position: absolute;
    z-index: 1;
    background: rgba(255, 255, 255, 0.35);
    filter: drop-shadow(0 0 1px rgba(0,0,0,0.35));
  }
  .guide-line.guide-h {
    left: 20%;
    right: 20%;
    top: 50%;
    height: 1px;
  }
  .guide-line.guide-v {
    top: 20%;
    bottom: 20%;
    left: 50%;
    width: 1px;
  }

  /* Status banner — anchored to the bottom edge so the camera stays visible behind it */
  .vf-banner {
    position: absolute;
    z-index: 2;
    left: 10px;
    right: 10px;
    bottom: 10px;
    text-align: center;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(4px);
    transition: background 0.15s;
  }
  .vf-banner-success {
    background: rgba(25, 25, 25, 0.92);
  }
  .vf-banner-warn {
    background: rgba(254, 243, 199, 0.95);
    border: 1px solid #fde68a;
  }
  .vf-banner-err {
    background: rgba(254, 226, 226, 0.95);
    border: 1px solid #fecaca;
  }
  .vf-hint {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    color: #555;
    letter-spacing: 0.04em;
  }
  .vf-status-row {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }
  .vf-status-row.success { color: #fff; }
  .vf-status-row.warn { color: #92400e; }
  .vf-status-row.err { color: #991b1b; }
  .vf-name {
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: #191919;
  }
  .vf-banner-success .vf-name { color: #fff; }
  .vf-meta {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    color: #888;
  }
  .vf-banner-success .vf-meta { color: #ccc; }
  .vf-banner-warn .vf-meta { color: #92400e; }
  .vf-banner-err .vf-meta { color: #991b1b; }

  /* ── Primary button ── */
  .btn-primary {
    font-family: 'Inter', sans-serif;
    font-size: 0.875rem;
    font-weight: 600;
    width: 100%;
    padding: 12px;
    background: #191919;
    color: #fff;
    border: 1px solid #191919;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    transition: background 0.12s, opacity 0.12s;
  }
  .btn-primary:hover { background: #333; border-color: #333; }
  .btn-primary:active { opacity: 0.8; }

  /* ── Manual entry ── */
  .manual-section {
    padding: 4px 0 14px;
    text-align: center;
  }
  .manual-toggle {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    color: #aaa;
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    padding: 4px 0;
    transition: color 0.1s;
  }
  .manual-toggle:hover { color: #555; }
  .manual-box {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    overflow: hidden;
    text-align: left;
  }
  .manual-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: #f4f4f4;
    border-bottom: 1px solid #e0e0e0;
  }
  .manual-close {
    background: none;
    border: none;
    cursor: pointer;
    color: #888;
    display: flex;
    align-items: center;
    padding: 2px;
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
  }
  .manual-close:hover { background: #e0e0e0; color: #191919; }
  .manual-row {
    display: flex;
    gap: 8px;
    padding: 12px;
  }
  .manual-input {
    font-family: 'Inter', sans-serif;
    font-size: 0.875rem;
    flex: 1;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 9px 12px;
    background: #fff;
    outline: none;
    color: #191919;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .manual-input:focus {
    border-color: #191919;
    box-shadow: 0 0 0 2px rgba(25,25,25,0.07);
  }
  .manual-go {
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 9px 16px;
    background: #191919;
    color: #fff;
    border: 1px solid #191919;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .manual-go:hover:not(:disabled) { background: #333; border-color: #333; }
  .manual-go:disabled { opacity: 0.35; cursor: not-allowed; }

  /* ── Divider ── */
  .divider {
    height: 1px;
    background: #e8e8e8;
    margin: 0;
  }

  /* ── Count pill ── */
  .count-pill {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    font-weight: 500;
    color: #888;
    background: #f4f4f4;
    border: 1px solid #e0e0e0;
    border-radius: 20px;
    padding: 1px 7px;
  }

  /* ── Recent scans ── */
  .recent-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 7px;
    transition: background 0.1s;
    background: #fff;
    border: 1px solid #f0f0f0;
  }
  .recent-row:hover { background: #fafafa; }
  .recent-row-new {
    animation: fadeIn 0.3s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .recent-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #191919;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .recent-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .recent-name {
    font-size: 0.85rem;
    font-weight: 500;
    color: #191919;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recent-group {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recent-time {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    color: #bbb;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .empty-state {
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
    color: #aaa;
    padding: 16px 0;
  }

  /* ── Wider screens: center card ── */
  @media (min-width: 520px) {
    :global(body) { background: #ebebeb; }
    .page {
      margin: 24px auto;
      border-radius: 12px;
      border: 1px solid #e0e0e0;
      min-height: unset;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
      overflow: hidden;
    }
    .topbar { border-radius: 12px 12px 0 0; }
  }
  /* ── Stats footer ── */
.stats-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 14px;
  background: #fff;
  border-top: 1px solid #e0e0e0;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  z-index: 10;
}
.stats-footer::-webkit-scrollbar { display: none; }
.stat-chip {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #f4f4f4;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.stat-chip:hover { background: #ebebeb; }
.stat-chip-active {
  background: #191919;
  border-color: #191919;
}
.stat-chip-name {
  font-family: 'DM Mono', monospace;
  font-size: 0.6rem;
  color: #888;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.stat-chip-active .stat-chip-name { color: #aaa; }
.stat-chip-count {
  font-size: 0.9rem;
  font-weight: 700;
  color: #191919;
  line-height: 1;
}
.stat-chip-active .stat-chip-count { color: #fff; }
</style>