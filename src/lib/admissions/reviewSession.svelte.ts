import { createClient } from '$lib/trpc/client';
import { HEARTBEAT_INTERVAL_MS, IDLE_GRACE_MS, IDLE_TIMEOUT_MS } from './lock';

/**
 * Lifecycle of one admin's review session on one applicant
 */
export type ReviewPhase =
	| 'idle' // nothing selected
	| 'acquiring' // claim in flight
	| 'owned' // we hold it
	| 'warning' // idle timeout hit; modal up; lock still held
	| 'expired' // grace elapsed, or the lock was lost
	| 'locked' // another admin holds it
	| 'error'; // the claim request itself failed

const IDLE_CHECK_MS = 5_000; // poll while open
/** Only runs while the modal is up. */
const COUNTDOWN_TICK_MS = 1_000;
const ACTIVITY_THROTTLE_MS = 1_000;

const CLAIM_DEBOUNCE_MS = 250;
const HEARTBEAT_FAILURE_LIMIT = 2;

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'] as const;

export function formatCountdown(ms: number): string {
	const total = Math.ceil(ms / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

/**
 * Next applicant nobody else is reviewing
 */
export function pickNextUnlocked(
	applicants: readonly { uid: string }[],
	presenceMap: Record<string, string>,
	fromIndex: number,
	excludeUid: string | null
): string | null {
	const count = applicants.length;
	if (count === 0) return null;
	const start = Math.max(0, Math.min(fromIndex, count - 1));
	for (let i = 0; i < count; i++) {
		const applicant = applicants[(start + i) % count];
		if (applicant.uid === excludeUid) continue;
		if (presenceMap[applicant.uid]) continue; // held by someone else
		return applicant.uid;
	}
	return null;
}

export type ReviewSessionOptions = {
	getUid: () => string | null;
	getPresence: () => Record<string, string>;
	onToast: (message: string, type?: 'success' | 'error') => void;
	onRerollNeeded?: (uid: string, claimerName: string | null) => void;
};

export function createReviewSession(options: ReviewSessionOptions) {
	const trpc = createClient();

	let phase = $state<ReviewPhase>('idle');
	let claimerName = $state<string | null>(null);
	let lockFreed = $state(false);
	let graceDeadline = $state<number | null>(null);
	let nowTick = $state(Date.now());

	let lastActivityAt = Date.now();
	let suppressActivity = false;

	let heldUid: string | null = null;
	let generation = 0;
	let rolling = false;
	let heartbeatFailures = 0;

	function releaseOnServer(uid: string) {
		void trpc.admissions.releaseClaim.mutate({ uid }).catch(() => {});
	}

	function releaseHeld() {
		const uid = heldUid;
		heldUid = null;
		if (uid) releaseOnServer(uid);
	}

	async function acquire(uid: string, gen: number) {
		try {
			const result = await trpc.admissions.claim.mutate({ uid });

			if (gen !== generation) {
				if (result.claimed) releaseOnServer(uid);
				return;
			}

			if (result.claimed) {
				heldUid = uid;
				heartbeatFailures = 0;
				lastActivityAt = Date.now();
				graceDeadline = null;
				claimerName = null;
				lockFreed = false;
				rolling = false;
				phase = 'owned';
				return;
			}

			heldUid = null;
			claimerName = result.claimerName;
			phase = 'locked';
			if (rolling) {
				rolling = false;
				options.onRerollNeeded?.(uid, result.claimerName);
			}
		} catch (error) {
			if (gen !== generation) return;
			heldUid = null;
			rolling = false;
			claimerName = null;
			phase = 'error';
			options.onToast(
				(error as Error)?.message ?? 'Could not open this applicant for review',
				'error'
			);
		}
	}

	function enterWarning() {
		graceDeadline = lastActivityAt + IDLE_TIMEOUT_MS + IDLE_GRACE_MS;
		nowTick = Date.now();
		phase = 'warning';
	}

	function endSession(message: string | null) {
		const uid = heldUid;
		heldUid = null;
		graceDeadline = null;
		claimerName = null;
		phase = 'expired';
		if (uid) releaseOnServer(uid);
		if (message) options.onToast(message, 'error');
	}

	function reconcile() {
		if (phase !== 'owned' && phase !== 'warning') return;
		const elapsed = Date.now() - lastActivityAt;
		if (elapsed >= IDLE_TIMEOUT_MS + IDLE_GRACE_MS) {
			endSession('Review session released after inactivity');
		} else if (elapsed >= IDLE_TIMEOUT_MS && phase === 'owned') {
			enterWarning();
		}
	}

	async function beat() {
		const uid = heldUid;
		if (!uid) return;

		if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS + IDLE_GRACE_MS) return;

		try {
			const result = await trpc.admissions.heartbeat.mutate({ uid });
			if (uid !== heldUid) return;
			heartbeatFailures = 0;
			if (!result.refreshed) {
				endSession(
					'Your review session ended — this applicant may be open in another tab, or was taken by another admin'
				);
			}
		} catch {
			if (uid !== heldUid) return;
			heartbeatFailures++;
			if (heartbeatFailures >= HEARTBEAT_FAILURE_LIMIT) {
				endSession('Lost connection — review paused');
			}
		}
	}

	function noteActivity() {
		if (suppressActivity) return;
		const now = Date.now();
		if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
		lastActivityAt = now;
	}

	// Claim lifecycle. Keyed on the selected uid only — reading presence here would
	// re-claim on every poll.
	$effect(() => {
		const uid = options.getUid();
		const gen = ++generation;

		if (!uid) {
			releaseHeld();
			phase = 'idle';
			claimerName = null;
			graceDeadline = null;
			return;
		}

		phase = 'acquiring';
		claimerName = null;
		lockFreed = false;
		const timer = setTimeout(() => void acquire(uid, gen), CLAIM_DEBOUNCE_MS);

		return () => {
			clearTimeout(timer);
			releaseHeld();
		};
	});

	// Heartbeat runs through `owned` AND `warning` — that is what holds the lock for
	// the duration of the countdown.
	$effect(() => {
		if (phase !== 'owned' && phase !== 'warning') return;
		const id = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
		return () => clearInterval(id);
	});

	// Two timer regimes, so the page is completely static while owned.
	$effect(() => {
		if (phase === 'owned') {
			const id = setInterval(reconcile, IDLE_CHECK_MS);
			return () => clearInterval(id);
		}
		if (phase === 'warning') {
			nowTick = Date.now();
			const id = setInterval(() => {
				nowTick = Date.now();
				if (graceDeadline !== null && nowTick >= graceDeadline) {
					endSession('Review session released after inactivity');
				}
			}, COUNTDOWN_TICK_MS);
			return () => clearInterval(id);
		}
	});

	$effect(() => {
		function onVisibilityChange() {
			suppressActivity = document.hidden;
			// Becoming visible is deliberately NOT activity — alt-tabbing past a window
			// should not renew a lock. A real return produces a pointermove instantly.
			if (!document.hidden) reconcile();
		}
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => document.removeEventListener('visibilitychange', onVisibilityChange);
	});

	// Once the holder lets go, offer a one-click claim rather than grabbing it
	$effect(() => {
		if (phase !== 'locked') {
			lockFreed = false;
			return;
		}
		const uid = options.getUid();
		lockFreed = !!uid && !options.getPresence()[uid];
	});

	const graceRemainingMs = $derived(
		graceDeadline === null ? 0 : Math.max(0, graceDeadline - nowTick)
	);

	return {
		get phase() {
			return phase;
		},
		get claimerName() {
			return claimerName;
		},
		get lockFreed() {
			return lockFreed;
		},
		get canDecide() {
			return phase === 'owned';
		},
		get showIdleModal() {
			return phase === 'warning';
		},
		get graceRemainingMs() {
			return graceRemainingMs;
		},
		get graceRemainingLabel() {
			return formatCountdown(graceRemainingMs);
		},

		observePane(el: HTMLElement) {
			const opts = { capture: true, passive: true } as const;
			for (const event of ACTIVITY_EVENTS) el.addEventListener(event, noteActivity, opts);
			return () => {
				for (const event of ACTIVITY_EVENTS) el.removeEventListener(event, noteActivity, opts);
			};
		},

		noteActivity,

		/** "I'm still reviewing" — re-assert the claim, re-rolling if it has moved. */
		confirm() {
			const uid = options.getUid();
			lastActivityAt = Date.now();
			graceDeadline = null;
			if (!uid) {
				phase = 'idle';
				return;
			}
			rolling = true;
			phase = 'acquiring';
			void acquire(uid, ++generation);
		},

		/** Explicit give-up from the modal (also what Escape maps to). */
		releaseNow() {
			endSession(null);
		},

		/** Claim / Resume review / Retry. */
		reclaim() {
			const uid = options.getUid();
			if (!uid) return;
			lastActivityAt = Date.now();
			phase = 'acquiring';
			void acquire(uid, ++generation);
		},

		markClaimCleared(uid: string) {
			if (heldUid === uid) heldUid = null;
		}
	};
}
