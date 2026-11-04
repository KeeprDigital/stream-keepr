import { formatClockTime } from './clock';

/** The bounds of a Round's duration, in minutes, as an operator enters it. */
export const ROUND_DURATION_MINUTES_MIN = 1;
export const ROUND_DURATION_MINUTES_MAX = 600;

/** A Round's operator-entered timing (ADR-0066): its start, in server epoch ms, and its duration. */
export interface RoundTiming {
	startedAt: number | null;
	durationMinutes: number | null;
}

/**
 * Where a Round Clock stands: `untimed` with no duration to count, `pending`
 * before its start (or with none), `running` until its end, `ended` after.
 */
export type RoundClockState = 'untimed' | 'pending' | 'running' | 'ended';

export interface RoundClockProjection {
	state: RoundClockState;
	/** The time remaining, as the clock shows it; `null` while untimed. */
	display: string | null;
	/** How long until the projection next changes, or `null` if it never will on its own. */
	nextChangeInMs: number | null;
}

/**
 * The Round Clock at `now` (server time): a pure projection of the Round's
 * timing, so every rendering of the same Round shows the same remaining time,
 * and nothing writes when it runs out (ADR-0066). Before the start it shows the
 * full duration, not running; after the end it shows `0:00`.
 */
export function projectRoundClock(timing: RoundTiming, now: number): RoundClockProjection {
	if (timing.durationMinutes == null)
		return { state: 'untimed', display: null, nextChangeInMs: null };

	const durationMs = timing.durationMinutes * 60_000;
	if (timing.startedAt == null || now < timing.startedAt) {
		return {
			state: 'pending',
			display: formatClockTime(durationMs),
			nextChangeInMs: timing.startedAt == null
				? null
				: timing.startedAt - now,
		};
	}

	const remainingMs = timing.startedAt + durationMs - now;
	if (remainingMs <= 0) {
		return {
			state: 'ended',
			display: formatClockTime(0),
			nextChangeInMs: null,
		};
	}

	return {
		state: 'running',
		display: formatClockTime(remainingMs),
		nextChangeInMs: remainingMs % 1000 || 1000,
	};
}
