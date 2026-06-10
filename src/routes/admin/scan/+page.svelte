<script>
//   import { writable } from 'svelte/store';

  // --- State ---
  let selectedGroup = 'Check-in';
  let manualInput = '';
  let scanState = 'idle'; // 'idle' | 'success' | 'error' | 'duplicate'
  let lastScan = null;
  let recentScans = [
    { name: 'Alex Chen',    time: '2:14 PM', group: 'Check-in' },
    { name: 'Jordan Lee',   time: '2:11 PM', group: 'Check-in' },
    { name: 'Sam Torres',   time: '2:09 PM', group: 'Check-in' },
  ];
  let errorMsg = '';
  let showManual = false;

  const groups = ['Check-in', 'Lunch Day 1', 'Lunch Day 2', 'Workshop A', 'Workshop B'];

  // Simulated attendee lookup (replace with real logic)
  const fakeAttendees = {
    'alex@example.com':   { name: 'Alex Chen',  role: 'Hacker',    school: 'UT Austin' },
    'jordan@example.com': { name: 'Jordan Lee',  role: 'Mentor',    school: 'Stanford' },
    'sam@example.com':    { name: 'Sam Torres',  role: 'Volunteer', school: 'MIT' },
    'duplicate':          { name: 'Jordan Lee',  role: 'Mentor',    school: 'Stanford' },
  };

  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function handleManualLookup() {
    const key = manualInput.trim().toLowerCase();
    if (!key) return;

    const attendee = fakeAttendees[key];
    if (!attendee) {
      scanState = 'error';
      errorMsg = 'No matching attendee found.';
      lastScan = null;
    } else if (key === 'duplicate') {
      scanState = 'duplicate';
      errorMsg = `${attendee.name} — already scanned for ${selectedGroup}.`;
      lastScan = attendee;
    } else {
      scanState = 'success';
      lastScan = attendee;
      const entry = { name: attendee.name, time: formatTime(new Date()), group: selectedGroup };
      recentScans = [entry, ...recentScans].slice(0, 20);
    }
    manualInput = '';
    showManual = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleManualLookup();
  }

  function scanNext() {
    scanState = 'idle';
    lastScan = null;
    errorMsg = '';
  }

  function toggleManual() {
    showManual = !showManual;
    if (!showManual) manualInput = '';
  }
</script>

<!-- ─── Fonts ─── -->
<svelte:head>
  <!-- <title>RODEO — Admin Scan</title> -->
  <link
    href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="page">

  <!-- Top bar -->
  <header class="topbar">
    <span class="topbar-brand">RODEO</span>
    <span class="topbar-label">ADMIN SCAN</span>
  </header>

  <main class="content">

    <!-- Group selector -->
    <section class="section">
      <label class="field-label" for="group-select">SCAN GROUP</label>
      <div class="select-wrap">
        <select id="group-select" class="group-select" bind:value={selectedGroup}>
          {#each groups as g}
            <option value={g}>{g}</option>
          {/each}
        </select>
        <span class="select-chevron">&#8964;</span>
      </div>
    </section>

    <!-- Viewfinder / scan area -->
    <section class="viewfinder-section">
      <div class="viewfinder" class:vf-success={scanState === 'success'} class:vf-error={scanState === 'error' || scanState === 'duplicate'}>
        <div class="corner tl"></div>
        <div class="corner tr"></div>
        <div class="corner bl"></div>
        <div class="corner br"></div>
        {#if scanState === 'idle'}
          <div class="vf-inner">
            <div class="scan-line"></div>
            <span class="vf-hint">Align QR code to scan</span>
          </div>
        {:else if scanState === 'success'}
          <div class="vf-confirm">
            <div class="vf-check">✓ Scan successful</div>
            <div class="vf-name">{lastScan.name}</div>
            <div class="vf-meta">{lastScan.role} · {lastScan.school}</div>
            <div class="vf-badge">CHECKED IN</div>
          </div>
        {:else if scanState === 'duplicate'}
          <div class="vf-confirm vf-confirm-err">
            <div class="vf-check err">⚠ Already scanned</div>
            <div class="vf-name">{lastScan.name}</div>
            <div class="vf-meta">{lastScan.role} · {lastScan.school}</div>
            <div class="vf-badge err-badge">DUPLICATE</div>
          </div>
        {:else if scanState === 'error'}
          <div class="vf-confirm vf-confirm-err">
            <div class="vf-check err">✕ Not found</div>
            <div class="vf-name" style="font-size:1rem;">Unknown QR code</div>
            <div class="vf-meta">{errorMsg}</div>
          </div>
        {/if}
      </div>
    </section>

    <!-- Action buttons -->
    {#if scanState !== 'idle'}
      <section class="section">
        <button class="btn-primary" on:click={scanNext}>Scan Next Person</button>
      </section>
    {/if}

    <!-- Manual entry toggle -->
    <section class="section manual-section">
      {#if !showManual}
        <button class="manual-toggle" on:click={toggleManual}>Can't scan? Enter manually</button>
      {:else}
        <div class="manual-row">
          <input
            class="manual-input"
            type="text"
            placeholder="Email or QR code…"
            bind:value={manualInput}
            on:keydown={handleKeydown}
            autofocus
          />
          <button class="manual-go" on:click={handleManualLookup}>Go</button>
        </div>
        <button class="manual-toggle" on:click={toggleManual} style="margin-top:6px;">Cancel</button>
      {/if}
    </section>

    <hr class="divider" />

    <!-- Recent scans -->
    <section class="section">
      <div class="field-label">RECENT SCANS</div>
      {#if recentScans.length === 0}
        <p class="empty-state">No scans yet for this session.</p>
      {:else}
        <ul class="recent-list">
          {#each recentScans as scan}
            <li class="recent-row">
              <span class="recent-name">{scan.name}</span>
              <span class="recent-meta">{scan.time} · {scan.group}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  </main>
</div>

<style>
  /* ─── Reset ─── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ─── Tokens ─── */
  :global(body) {
    font-family: 'Inter', system-ui, sans-serif;
    background: #fff;
    color: #000;
    -webkit-font-smoothing: antialiased;
  }

  /* ─── Layout ─── */
  .page {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    max-width: 480px;
    margin: 0 auto;
  }

  /* ─── Top bar ─── */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #000;
    color: #fff;
    padding: 12px 16px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .topbar-brand {
    font-family: 'Playfair Display', serif;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .topbar-label {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    color: #aaa;
    text-transform: uppercase;
  }

  /* ─── Content ─── */
  .content {
    flex: 1;
    padding: 0 16px 32px;
  }

  .section {
    padding: 16px 0;
  }

  .field-label {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    color: #aaa;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: block;
  }

  /* ─── Group select ─── */
  .select-wrap {
    position: relative;
  }
  .group-select {
    font-family: 'DM Mono', monospace;
    font-size: 0.85rem;
    width: 100%;
    border: 1px solid #000;
    border-radius: 0;
    padding: 10px 36px 10px 12px;
    background: #fff;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    outline: none;
  }
  .group-select:focus {
    outline: 2px solid #000;
    outline-offset: 2px;
  }
  .select-chevron {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    font-size: 1.1rem;
    color: #000;
  }

  /* ─── Viewfinder ─── */
  .viewfinder-section {
    padding: 0 0 8px;
  }
  .viewfinder {
    border: 2px solid #000;
    position: relative;
    background: #f4f4f4;
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s;
  }
  .viewfinder.vf-success { border-color: #000; background: #fff; }
  .viewfinder.vf-error   { border-color: #000; background: #f4f4f4; }

  /* Corner brackets */
  .corner {
    position: absolute;
    width: 18px;
    height: 18px;
    border-color: #000;
    border-style: solid;
  }
  .corner.tl { top: 8px;    left: 8px;    border-width: 2px 0 0 2px; }
  .corner.tr { top: 8px;    right: 8px;   border-width: 2px 2px 0 0; }
  .corner.bl { bottom: 8px; left: 8px;    border-width: 0 0 2px 2px; }
  .corner.br { bottom: 8px; right: 8px;   border-width: 0 2px 2px 0; }

  /* Idle state */
  .vf-inner { text-align: center; position: relative; width: 100%; padding: 40px 0; }
  .scan-line {
    position: absolute;
    left: 12%;
    right: 12%;
    height: 1px;
    background: #000;
    opacity: 0.25;
    top: 48%;
  }
  .vf-hint {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #aaa;
    letter-spacing: 0.05em;
  }

  /* Confirm state */
  .vf-confirm {
    text-align: center;
    padding: 28px 24px;
    width: 100%;
  }
  .vf-check {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #aaa;
    margin-bottom: 6px;
    letter-spacing: 0.06em;
  }
  .vf-check.err { color: #000; }
  .vf-name {
    font-family: 'Playfair Display', serif;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.1;
    margin-bottom: 4px;
  }
  .vf-meta {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #aaa;
    margin-bottom: 12px;
  }
  .vf-badge {
    display: inline-block;
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    background: #000;
    color: #fff;
    padding: 4px 14px;
  }
  .err-badge {
    background: #fff;
    color: #000;
    border: 1px solid #000;
  }

  /* ─── Primary button ─── */
  .btn-primary {
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    width: 100%;
    padding: 14px;
    background: #000;
    color: #fff;
    border: none;
    cursor: pointer;
    text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .btn-primary:active { opacity: 0.75; }

  /* ─── Manual entry ─── */
  .manual-section { padding-top: 4px; }
  .manual-toggle {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #aaa;
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    display: block;
    width: 100%;
    text-align: center;
    padding: 4px 0;
  }
  .manual-row {
    display: flex;
    gap: 6px;
  }
  .manual-input {
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    flex: 1;
    border: 1px solid #000;
    padding: 10px 12px;
    background: #fff;
    outline: none;
    border-radius: 0;
  }
  .manual-input:focus {
    outline: 2px solid #000;
    outline-offset: 2px;
  }
  .manual-go {
    font-family: 'DM Mono', monospace;
    font-size: 0.75rem;
    padding: 10px 18px;
    background: #000;
    color: #fff;
    border: none;
    cursor: pointer;
    letter-spacing: 0.05em;
  }

  /* ─── Divider ─── */
  .divider {
    border: none;
    border-top: 1px solid #000;
    margin: 0;
  }

  /* ─── Recent scans ─── */
  .recent-list {
    list-style: none;
  }
  .recent-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 9px 0;
    border-bottom: 1px solid #f0f0f0;
  }
  .recent-row:last-child { border-bottom: none; }
  .recent-name {
    font-size: 0.9rem;
    font-weight: 500;
  }
  .recent-meta {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #aaa;
    white-space: nowrap;
    margin-left: 8px;
  }
  .empty-state {
    font-family: 'DM Mono', monospace;
    font-size: 0.75rem;
    color: #aaa;
    padding: 12px 0;
  }

  /* ─── Responsive: wider screens get a centered card ─── */
  @media (min-width: 520px) {
    .page {
      border-left: 1px solid #e0e0e0;
      border-right: 1px solid #e0e0e0;
      min-height: 100svh;
    }
  }
</style>