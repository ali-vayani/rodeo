/**
 * Timing constants for the applicant review lock. Shared by the admissions router and
 * the client session so the two sides agree on what "stale" means.
 */

// Server side: a claim whose `claimedAt` is older than this is treated as abandoned
// (tab crashed, network dropped) and may be taken by someone else. Heartbeats refresh
// it, so this must stay comfortably above HEARTBEAT_INTERVAL_MS.
export const CLAIM_TTL_MS = 2 * 60 * 1000;

export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Client side: no activity for this long puts up the idle modal.
export const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

// How long the idle modal counts down before the session releases itself.
export const IDLE_GRACE_MS = 30 * 1000;

// How often the admissions page refreshes who holds which applicant.
export const PRESENCE_POLL_MS = 20 * 1000;
