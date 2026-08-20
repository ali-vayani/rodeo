/**
 * Timing constants for the applicant review lock.
 */

// a claim is stale once `clamedAt` is older than this. mainly used to check crashes
export const CLAIM_TTL_MS = 2 * 60 * 1000;

export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // a claim is stale once `claimedAt` is older than this.

export const IDLE_GRACE_MS = 30 * 1000; // modal count down time

export const PRESENCE_POLL_MS = 20 * 1000; // how often we check who's checking which application
