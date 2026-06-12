<script lang="ts">
  // --- Types ---
  interface Attendee {
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

  // --- State ---
  let selectedGroup = $state('Check-in');
  let manualInput = $state('');
  let scanState = $state<ScanState>('idle');
  let lastScan = $state<Attendee | null>(null);
  let errorMsg = $state('');
  let showManual = $state(false);
  let statsOpen = $state(false);

  let recentScans = $state<ScanEntry[]>([
    { name: 'Alex Chen',   time: '2:14 PM', group: 'Check-in' },
    { name: 'Jordan Lee',  time: '2:11 PM', group: 'Check-in' },
    { name: 'Sam Torres',  time: '2:09 PM', group: 'Check-in' },
  ]);

  const groups = ['Check-in', 'Lunch Day 1', 'Lunch Day 2', 'Workshop A', 'Workshop B'];

  // Scan counts per group
  let scanCounts = $state<Record<string, number>>({
    'Check-in':    542,
    'Lunch Day 1': 530,
    'Lunch Day 2': 0,
    'Workshop A':  214,
    'Workshop B':  189,
  });

  // Total registered (simulated)
  const totalRegistered = 600;

  const fakeAttendees: Record<string, Attendee> = {
    'alex@example.com':   { name: 'Alex Chen',   role: 'Hacker',    school: 'UT Austin' },
    'jordan@example.com': { name: 'Jordan Lee',   role: 'Mentor',    school: 'Stanford'  },
    'sam@example.com':    { name: 'Sam Torres',   role: 'Volunteer', school: 'MIT'       },
    'duplicate':          { name: 'Jordan Lee',   role: 'Mentor',    school: 'Stanford'  },
  };

  function formatTime(date: Date): string {
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
      const entry: ScanEntry = { name: attendee.name, time: formatTime(new Date()), group: selectedGroup };
      recentScans = [entry, ...recentScans].slice(0, 20);
      scanCounts[selectedGroup] = (scanCounts[selectedGroup] ?? 0) + 1;
    }
    manualInput = '';
    showManual = false;
  }

  function handleKeydown(e: KeyboardEvent) {
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
      <label class="field-label" for="group-select">Scan Group</label>
      <div class="select-wrap">
        <select id="group-select" class="group-select" bind:value={selectedGroup}>
          {#each groups as g (g)}
            <option value={g}>{g}</option>
          {/each}
        </select>
        <svg class="select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </section>

    <!-- ── Stats panel (collapsible) ── -->
    <section class="stats-section">
      <button class="stats-toggle" onclick={() => statsOpen = !statsOpen}>
        <span class="stats-toggle-left">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="6" height="18"></rect>
            <rect x="9" y="8" width="6" height="13"></rect>
            <rect x="16" y="13" width="6" height="8"></rect>
          </svg>
          Scan Counts
        </span>
        <span class="stats-toggle-right">
          <span class="stats-total-badge">{totalScanned} total</span>
          <svg
            class="stats-chevron"
            class:open={statsOpen}
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </button>

      {#if statsOpen}
        <div class="stats-panel">
          {#each groups as g (g)}
            {@const count = scanCounts[g] ?? 0}
            {@const pct = Math.round((count / totalRegistered) * 100)}
            <div class="stat-row" class:stat-row-active={g === selectedGroup}>
              <div class="stat-row-top">
                <span class="stat-name">{g}</span>
                <span class="stat-count">
                  <span class="stat-count-num">{count}</span>
                  <span class="stat-count-total">/ {totalRegistered}</span>
                </span>
              </div>
              <div class="stat-bar-track">
                <div class="stat-bar-fill" style="width: {pct}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- ── Viewfinder ── -->
    <section class="viewfinder-section">
      <div
        class="viewfinder"
        class:vf-success={scanState === 'success'}
        class:vf-error={scanState === 'error' || scanState === 'duplicate'}
      >
        <!-- Corner brackets -->
        <div class="corner tl"></div>
        <div class="corner tr"></div>
        <div class="corner bl"></div>
        <div class="corner br"></div>

        {#if scanState === 'idle'}
          <div class="vf-idle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#d1d1d1;">
              <rect x="3" y="3" width="5" height="5" rx="0.5"></rect>
              <rect x="16" y="3" width="5" height="5" rx="0.5"></rect>
              <rect x="3" y="16" width="5" height="5" rx="0.5"></rect>
              <rect x="10" y="10" width="4" height="4" rx="0.5"></rect>
              <line x1="16" y1="10" x2="16" y2="10.01"></line>
              <line x1="21" y1="10" x2="21" y2="10.01"></line>
              <line x1="16" y1="16" x2="21" y2="21"></line>
              <line x1="16" y1="21" x2="21" y2="16"></line>
            </svg>
            <span class="vf-hint">Align QR code within frame</span>
          </div>

        {:else if scanState === 'success'}
          <div class="vf-result">
            <div class="vf-status-row success">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Scan successful
            </div>
            <div class="vf-name">{lastScan?.name}</div>
            <div class="vf-meta">{lastScan?.role} · {lastScan?.school}</div>
            <div class="vf-badge success-badge">Checked in — {selectedGroup}</div>
          </div>

        {:else if scanState === 'duplicate'}
          <div class="vf-result">
            <div class="vf-status-row warn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Already scanned
            </div>
            <div class="vf-name">{lastScan?.name}</div>
            <div class="vf-meta">{lastScan?.role} · {lastScan?.school}</div>
            <div class="vf-badge warn-badge">Duplicate — {selectedGroup}</div>
          </div>

        {:else if scanState === 'error'}
          <div class="vf-result">
            <div class="vf-status-row err">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              Not found
            </div>
            <div class="vf-name" style="font-size: 1rem;">Unknown QR code</div>
            <div class="vf-meta">{errorMsg}</div>
          </div>
        {/if}
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
              placeholder="Email or QR code…"
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
  {#each groups as g (g)}
    <button class="stat-chip" class:stat-chip-active={g === selectedGroup} onclick={() => selectedGroup = g}>
      <span class="stat-chip-name">{g}</span>
      <span class="stat-chip-count">{scanCounts[g] ?? 0}</span>
    </button>
  {/each}
</footer>
</div>

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
    min-height: 200px;
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

  /* Corner brackets */
  .corner {
    position: absolute;
    width: 16px;
    height: 16px;
    border-color: #c8c8c8;
    border-style: solid;
  }
  .corner.tl { top: 10px;    left: 10px;    border-width: 2px 0 0 2px; border-radius: 2px 0 0 0; }
  .corner.tr { top: 10px;    right: 10px;   border-width: 2px 2px 0 0; border-radius: 0 2px 0 0; }
  .corner.bl { bottom: 10px; left: 10px;    border-width: 0 0 2px 2px; border-radius: 0 0 0 2px; }
  .corner.br { bottom: 10px; right: 10px;   border-width: 0 2px 2px 0; border-radius: 0 0 2px 0; }

  /* Idle */
  .vf-idle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 0;
  }
  .vf-hint {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    color: #aaa;
    letter-spacing: 0.04em;
  }

  /* Result states */
  .vf-result {
    text-align: center;
    padding: 28px 20px;
    width: 100%;
  }
  .vf-status-row {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    margin-bottom: 10px;
    padding: 3px 10px;
    border-radius: 20px;
  }
  .vf-status-row.success {
    background: rgba(25,25,25,0.06);
    color: #191919;
  }
  .vf-status-row.warn {
    background: #fef3c7;
    color: #92400e;
  }
  .vf-status-row.err {
    background: #fee2e2;
    color: #991b1b;
  }
  .vf-name {
    font-size: 1.4rem;
    font-weight: 700;
    color: #191919;
    line-height: 1.15;
    margin-bottom: 4px;
    letter-spacing: -0.02em;
  }
  .vf-meta {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    color: #888;
    margin-bottom: 14px;
  }
  .vf-badge {
    display: inline-block;
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    padding: 4px 14px;
    border-radius: 4px;
  }
  .success-badge {
    background: #191919;
    color: #fff;
  }
  .warn-badge {
    background: #fff;
    color: #92400e;
    border: 1px solid #fde68a;
  }

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