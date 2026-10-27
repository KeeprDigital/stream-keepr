import type { LiveResultsTarget } from './currentRound';

/** Results polling interval while the Current Round is incomplete. */
export const LIVE_RESULTS_INTERVAL_MS = 60_000;
/** With no change for this long, results polling slows to the quiet interval. */
export const LIVE_RESULTS_QUIET_AFTER_MS = 1_800_000;
export const LIVE_RESULTS_QUIET_INTERVAL_MS = 300_000;
/** Probe and failure backoff: base × 2^step, capped. */
export const LIVE_RESULTS_BACKOFF_BASE_MS = 60_000;
export const LIVE_RESULTS_BACKOFF_CAP_MS = 900_000;
/** With no change of any kind for longer than this, Live Results stops itself. */
export const LIVE_RESULTS_IDLE_STOP_MS = 43_200_000;

export type LiveResultsOutcome = 'changed' | 'unchanged' | 'failed' | 'auth-failed';
export type LiveResultsStopReason = 'idle' | 'auth';

export interface LiveResultsScheduleInput {
	now: Date;
	target: LiveResultsTarget['kind'];
	outcome: LiveResultsOutcome;
	backoffStep: number;
	lastChangeAt: Date;
}

export interface LiveResultsSchedule {
	nextCheckAt: Date;
	backoffStep: number;
	lastChangeAt: Date;
	stop: LiveResultsStopReason | null;
}

/**
 * When the next Live Results tick runs after one with `outcome`. Results poll
 * every minute, slowing after a quiet half hour; probing, idling and failures
 * back off from a minute to a cap. A change resets both. Melee refusing
 * authentication, or 12 hours with no change, stops Live Results.
 */
export function nextLiveResultsSchedule(input: LiveResultsScheduleInput): LiveResultsSchedule {
	const { now, target, outcome, backoffStep, lastChangeAt } = input;
	const after = (ms: number) => new Date(now.getTime() + ms);

	if (outcome === 'changed') {
		return {
			nextCheckAt: after(LIVE_RESULTS_INTERVAL_MS),
			backoffStep: 0,
			lastChangeAt: now,
			stop: null,
		};
	}

	const quietFor = now.getTime() - lastChangeAt.getTime();
	const stop: LiveResultsStopReason | null = outcome === 'auth-failed'
		? 'auth'
		: quietFor > LIVE_RESULTS_IDLE_STOP_MS
			? 'idle'
			: null;
	if (stop) {
		return {
			nextCheckAt: now,
			backoffStep,
			lastChangeAt,
			stop,
		};
	}

	if (outcome === 'unchanged' && target === 'results') {
		const interval = quietFor > LIVE_RESULTS_QUIET_AFTER_MS
			? LIVE_RESULTS_QUIET_INTERVAL_MS
			: LIVE_RESULTS_INTERVAL_MS;
		return {
			nextCheckAt: after(interval),
			backoffStep: 0,
			lastChangeAt,
			stop: null,
		};
	}

	const backoff = Math.min(LIVE_RESULTS_BACKOFF_BASE_MS * 2 ** backoffStep, LIVE_RESULTS_BACKOFF_CAP_MS);
	return {
		nextCheckAt: after(backoff),
		backoffStep: backoffStep + 1,
		lastChangeAt,
		stop: null,
	};
}
