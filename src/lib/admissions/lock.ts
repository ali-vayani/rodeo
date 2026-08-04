/**
 * Timing constants for the applicant review lock.
 *
 * Lives under `$lib/` (not `$lib/server/`) because both the tRPC router and the
 * browser session module import it — keeping them in one place is what stops the
 * server TTL and the client heartbeat from drifting apart.
 */

/**
 * Server-side lock lifetime. A claim is stale once `claimedAt` is older than this.
 *
 * This is a crash / tab-close backstop ONLY — it is NOT the idle policy. The client
 * heartbeats through both the active state and the grace countdown, so this only
 * ever fires when a tab dies without releasing.
 */
export const CLAIM_TTL_MS = 2 * 60 * 1000;

/** Heartbeat cadence, while the reviewer is active OR the grace modal is counting down. */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * No user input for this long → show the "still reviewing?" modal.
 *
 * Deliberately a separate constant from CLAIM_TTL_MS even though they are currently
 * equal: this one is UX policy (when to nag a human), that one is a crash backstop.
 * Raising this needs no server change.
 */
export const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

/** Countdown inside the modal. The lock is HELD (still heartbeating) throughout. */
export const IDLE_GRACE_MS = 30 * 1000;

/** How often the applicant list refreshes who-is-reviewing-what. */
export const PRESENCE_POLL_MS = 20 * 1000;

// INVARIANT: HEARTBEAT_INTERVAL_MS * 2 < CLAIM_TTL_MS (survive one dropped beat)
