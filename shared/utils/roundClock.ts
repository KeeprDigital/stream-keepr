import { countdownNextChangeInMs, countUpOvertimeMs, formatClockTime, formatCountdownTime } from './clock';

/** The bounds of a Round's duration, in minutes, as an operator enters it. */
export const ROUND_DURATION_MINUTES_MIN = 1;
export const ROUND_DURATION_MINUTES_MAX = 600;

/** A Round's operator-entered timing (ADR-0066): its start, in server epoch ms, and its duration. */
export interface RoundTiming {
	startedAt: number | null;
	durationMinutes: number | null;
}

/**
 * Whether a Round Clock counts up after its Round ends, as its Screen sets it,
 * and the minutes it counts up to before holding (`null`: no limit).
 */
export interface RoundClockCountUp {
	enabled: boolean;
	limitMinutes: number | null;
}

const NO_COUNT_UP: RoundClockCountUp = { enabled: false, limitMinutes: null };

/**
 * Where a Round Clock stands: `untimed` with no duration to count, `pending`
 * before its start (or with none), `running` until its end, `ended` after.
 */
export type RoundClockState = 'untimed' | 'pending' | 'running' | 'ended';

export interface RoundClockProjection {
	state: RoundClockState;
	/** The time remaining, or since the end, as the clock shows it; `null` while untimed. */
	display: string | null;
	/** How long until the projection next changes, or `null` if it never will on its own. */
	nextChangeInMs: number | null;
}

/**
 * The Round Clock at `now` (server time): a pure projection of the Round's
 * timing, so every rendering of the same Round shows the same remaining time,
 * and nothing writes when it runs out (ADR-0066). Before the start it shows the
 * full duration, not running; after the end it shows `0:00`, or, counting up,
 * the time since the end up to its limit. Time remaining rounds up and time
 * since the end rounds down (ADR-0078).
 */
export function projectRoundClock(timing: RoundTiming, now: number, countUp: RoundClockCountUp = NO_COUNT_UP): RoundClockProjection {
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
	if (remainingMs <= 0 && countUp.enabled) {
		const overMs = -remainingMs;
		const limitMs = countUp.limitMinutes == null
			? null
			: countUp.limitMinutes * 60_000;
		return {
			state: 'ended',
			display: formatClockTime(countUpOvertimeMs(overMs, limitMs)),
			nextChangeInMs: limitMs != null && overMs >= limitMs
				? null
				: 1000 - (overMs % 1000),
		};
	}

	if (remainingMs <= 0) {
		return {
			state: 'ended',
			display: formatClockTime(0),
			nextChangeInMs: null,
		};
	}

	return {
		state: 'running',
		display: formatCountdownTime(remainingMs),
		nextChangeInMs: countdownNextChangeInMs(remainingMs),
	};
}
