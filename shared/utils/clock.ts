import type { ClockState, ClockType } from '../types/featureMatchState';

const DIGITS_ONLY_RE = /^\d+$/;
const NON_DIGIT_RE = /\D/g;

// ──────────────── Count-up limit ────────────────

/** The bounds of a count-up limit, in minutes, as an operator enters it; none counts up without limit. */
export const COUNT_UP_LIMIT_MINUTES_MIN = 1;
export const COUNT_UP_LIMIT_MINUTES_MAX = 600;

/**
 * The overtime a clock that counts up after running out shows, `overMs` past
 * its end: it counts up to its limit, then holds there. A `null` limit never holds.
 */
export function countUpOvertimeMs(overMs: number, limitMs: number | null | undefined): number {
	const overtimeMs = Math.max(0, overMs);
	return limitMs == null
		? overtimeMs
		: Math.min(overtimeMs, limitMs);
}

// ──────────────── Time Formatting ────────────────

/**
 * Format milliseconds as mm:ss or h:mm:ss, rounding down: for a length of time,
 * and for time counting up. Time remaining takes `formatCountdownTime`.
 */
export function formatClockTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format the time remaining on a countdown, rounding up (ADR-0078): it reads
 * its full duration through its first second, and `0:00` only once none remains.
 */
export function formatCountdownTime(remainingMs: number): string {
	return formatClockTime(Math.ceil(Math.max(0, remainingMs) / 1000) * 1000);
}

/**
 * How long until what `formatCountdownTime` shows for `remainingMs` (above zero)
 * next changes: when the time remaining reaches the next whole second down.
 */
export function countdownNextChangeInMs(remainingMs: number): number {
	return remainingMs % 1000 || 1000;
}

/**
 * Normalizes raw time input into canonical mm:ss or h:mm:ss format.
 * Interprets digit-only input based on length:
 * - 1-2 digits: minutes only (e.g., "45" -> "45:00")
 * - 3 digits: m:ss (e.g., "530" -> "05:30")
 * - 4 digits: mm:ss (e.g., "1234" -> "12:34")
 * - 5 digits: h:mm:ss (e.g., "12345" -> "1:23:45")
 * - 6 digits: hh:mm:ss (e.g., "123456" -> "12:34:56")
 * Returns null if input cannot be normalized.
 */
export function normalizeTimeInput(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed)
		return null;

	// If already contains colons, validate and pass through. Range checks must
	// match parseTimeInput's — every string returned here is canonical, so the
	// parser must accept it.
	if (trimmed.includes(':')) {
		const parts = trimmed.split(':');
		if ((parts.length !== 2 && parts.length !== 3) || !parts.every(p => DIGITS_ONLY_RE.test(p)))
			return null;
		const seconds = Number(parts[parts.length - 1]);
		const minutes = Number(parts[parts.length - 2]);
		if (seconds >= 60 || (parts.length === 3 && minutes >= 60))
			return null;
		return trimmed;
	}

	// Strip non-digits for pure numeric input
	const digits = trimmed.replace(NON_DIGIT_RE, '');
	if (!digits)
		return null;

	let mm: string, ss: string, hh: string;

	switch (digits.length) {
		case 1:
		case 2:
			return `${digits}:00`;
		case 3:
			mm = digits.slice(0, 1).padStart(2, '0');
			ss = digits.slice(1);
			return Number(ss) >= 60
				? null
				: `${mm}:${ss}`;
		case 4:
			mm = digits.slice(0, 2);
			ss = digits.slice(2);
			return Number(ss) >= 60
				? null
				: `${mm}:${ss}`;
		case 5:
			hh = digits.slice(0, 1);
			mm = digits.slice(1, 3);
			ss = digits.slice(3);
			return (Number(mm) >= 60 || Number(ss) >= 60)
				? null
				: `${hh}:${mm}:${ss}`;
		case 6:
			hh = digits.slice(0, 2);
			mm = digits.slice(2, 4);
			ss = digits.slice(4);
			return (Number(mm) >= 60 || Number(ss) >= 60)
				? null
				: `${hh}:${mm}:${ss}`;
		default:
			return null;
	}
}

/** Parse a time string (mm:ss or h:mm:ss) into milliseconds. Returns null if invalid. */
export function parseTimeInput(input: string): number | null {
	const normalized = normalizeTimeInput(input);
	if (!normalized)
		return null;

	const parts = normalized.split(':').map(Number);
	if (parts.some(p => Number.isNaN(p) || p < 0))
		return null;

	if (parts.length === 2) {
		const [minutes, seconds] = parts;
		if (minutes == null || seconds == null || seconds >= 60)
			return null;
		return (minutes * 60 + seconds) * 1000;
	}

	if (parts.length === 3) {
		const [hours, minutes, seconds] = parts;
		if (hours == null || minutes == null || seconds == null || minutes >= 60 || seconds >= 60)
			return null;
		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	}

	return null;
}

// ──────────────── Clock State Calculations ────────────────

/**
 * A Feature Match Session clock as the app holds it: running from a server
 * instant, or stopped with the time it has run. Whether it runs is whether it
 * holds a start, so a clock running with no start, or stopped with one, cannot
 * be built. The stored Session state keeps its own shape (`ClockState`);
 * `readStoredClock` and `writeStoredClock` are where the two meet.
 */
export interface FeatureMatchClock {
	type: ClockType;
	durationMs: number;
	/** The time run before `startedAt`, or in all on a stopped clock. */
	elapsedMs: number;
	/** The server instant a running clock runs from; `null` on a stopped clock. */
	startedAt: number | null;
	/** Whether a countdown counts up after it runs out, showing its overtime. */
	countUpAfterCountdown: boolean;
	/** How far that overtime counts before holding; `null` counts up without limit. */
	countUpLimitMs: number | null;
}

/**
 * A stored clock as the app holds it. One stored running with no start reads as
 * stopped at its stored elapsed time, a start stored on a stopped clock is
 * ignored, and one stored before the count-up limit existed has no limit.
 */
export function readStoredClock(stored: ClockState): FeatureMatchClock {
	return {
		type: stored.type,
		durationMs: stored.durationMs,
		elapsedMs: stored.elapsedMs,
		startedAt: stored.isRunning
			? stored.lastStartedAt ?? null
			: null,
		countUpAfterCountdown: stored.countUpAfterCountdown,
		countUpLimitMs: stored.countUpLimitMs ?? null,
	};
}

/** A clock in the shape the Session state stores and its reads and messages carry. */
export function writeStoredClock(clock: FeatureMatchClock): ClockState {
	return {
		type: clock.type,
		durationMs: clock.durationMs,
		elapsedMs: clock.elapsedMs,
		isRunning: clock.startedAt !== null,
		lastStartedAt: clock.startedAt,
		countUpAfterCountdown: clock.countUpAfterCountdown,
		countUpLimitMs: clock.countUpLimitMs,
	};
}

/** The time a clock has run by `now`, never below zero: the one elapsed-time sum. */
export function getEffectiveElapsedMs(clock: FeatureMatchClock, now: number): number {
	const runningMs = clock.startedAt === null
		? 0
		: now - clock.startedAt;
	return Math.max(0, clock.elapsedMs + runningMs);
}

/**
 * Where a Feature Match Session clock stands. Where its time stands outranks
 * whether it is counting: a countdown past its end is `run-out`, or, counting up
 * after, `counting-up` until it is `holding` at its count-up limit, running or
 * not. With time left it is `running`, `paused` once any time has run, or
 * `stopped` before any has. An Untimed Match's clock is `untimed`.
 */
export type FeatureMatchClockState
	= | 'untimed'
		| 'stopped'
		| 'paused'
		| 'running'
		| 'run-out'
		| 'counting-up'
		| 'holding';

export interface FeatureMatchClockProjection {
	state: FeatureMatchClockState;
	/** What the clock shows: a time, or the Untimed Label for an untimed clock. */
	display: string;
	/** The time run, by the stored time and, while running, the time since its start. */
	elapsedMs: number;
	/** The time a countdown has left, never below zero; `null` for any other clock. */
	remainingMs: number | null;
	/** How long until `display` next changes, or `null` if it never will on its own. */
	nextChangeInMs: number | null;
}

/**
 * A Feature Match Session clock at `now` (server time): one pure projection, so
 * what a rendering shows, the state it reads and when it next changes cannot
 * disagree. A countdown shows its time remaining, its overtime once run out if
 * it counts up after (holding at its count-up limit, ADR-0076), and any other
 * clock its elapsed time; an untimed clock shows the Event's Untimed Label, and
 * no clock `0:00`. Whether a blank Untimed Label hides the clock is the caller's
 * to decide. Time remaining rounds up and changes as each whole second remaining
 * is reached, its last at the end; elapsed time and overtime round down and
 * change on the whole second (ADR-0078). Only a running clock changes.
 */
export function projectFeatureMatchClock(clock: FeatureMatchClock | null, now: number, untimedLabel: string): FeatureMatchClockProjection {
	if (!clock) {
		return {
			state: 'stopped',
			display: formatClockTime(0),
			elapsedMs: 0,
			remainingMs: null,
			nextChangeInMs: null,
		};
	}

	const elapsedMs = getEffectiveElapsedMs(clock, now);
	if (clock.type === 'untimed') {
		return {
			state: 'untimed',
			display: untimedLabel.trim(),
			elapsedMs,
			remainingMs: null,
			nextChangeInMs: null,
		};
	}

	const counts = clock.startedAt !== null;
	let counting: FeatureMatchClockState = 'stopped';
	if (counts)
		counting = 'running';
	else if (clock.elapsedMs > 0)
		counting = 'paused';

	if (clock.type !== 'countdown') {
		return {
			state: counting,
			display: formatClockTime(elapsedMs),
			elapsedMs,
			remainingMs: null,
			nextChangeInMs: counts
				? 1000 - (elapsedMs % 1000)
				: null,
		};
	}

	const remainingMs = clock.durationMs - elapsedMs;
	if (remainingMs > 0) {
		return {
			state: counting,
			display: formatCountdownTime(remainingMs),
			elapsedMs,
			remainingMs,
			nextChangeInMs: counts
				? countdownNextChangeInMs(remainingMs)
				: null,
		};
	}

	if (!clock.countUpAfterCountdown) {
		return {
			state: 'run-out',
			display: formatClockTime(0),
			elapsedMs,
			remainingMs: 0,
			nextChangeInMs: null,
		};
	}

	const overMs = -remainingMs;
	const holds = clock.countUpLimitMs != null && overMs >= clock.countUpLimitMs;
	return {
		state: holds ? 'holding' : 'counting-up',
		display: formatClockTime(countUpOvertimeMs(overMs, clock.countUpLimitMs)),
		elapsedMs,
		remainingMs: 0,
		nextChangeInMs: counts && !holds
			? 1000 - (overMs % 1000)
			: null,
	};
}

export interface ClockAdjustmentInput {
	deltaDisplayMs?: number;
	targetDisplayMs?: number;
}

/**
 * Move a clock by `deltaDisplayMs`, or set it to `targetDisplayMs`.
 *
 * On a countdown a delta moves the end: `+` gives time back, `−` takes it away.
 * A countdown counting up past its end keeps that direction, its overtime being
 * time remaining below zero: `−` lengthens the overtime it shows (what it holds
 * at, if it holds at its count-up limit), `+` shortens it and, past zero, counts
 * down again. A `−` before the end stops at the end, and a set-to always sets a
 * time of that length, which on a countdown is time remaining.
 */
export function applyClockAdjustment(
	clock: FeatureMatchClock,
	now: number,
	adjustment: ClockAdjustmentInput,
): FeatureMatchClock {
	const effectiveElapsedMs = getEffectiveElapsedMs(clock, now);
	const inOvertime = clock.type === 'countdown'
		&& clock.countUpAfterCountdown
		&& effectiveElapsedMs >= clock.durationMs;
	let currentDisplayMs = effectiveElapsedMs;
	if (inOvertime)
		currentDisplayMs = -countUpOvertimeMs(effectiveElapsedMs - clock.durationMs, clock.countUpLimitMs);
	else if (clock.type === 'countdown')
		currentDisplayMs = Math.max(0, clock.durationMs - effectiveElapsedMs);

	const adjustedDisplayMs = currentDisplayMs + (adjustment.deltaDisplayMs ?? 0);
	const targetDisplayMs = adjustment.targetDisplayMs === undefined && inOvertime
		? adjustedDisplayMs
		: Math.max(0, adjustment.targetDisplayMs ?? adjustedDisplayMs);

	if (clock.type === 'countdown') {
		// A negative target is overtime, which is elapsed time past the duration.
		// More overtime than the clock has run cannot come off the duration alone.
		const durationMs = Math.max(0, effectiveElapsedMs + targetDisplayMs);
		return {
			...clock,
			durationMs,
			elapsedMs: durationMs - targetDisplayMs,
			startedAt: clock.startedAt === null
				? null
				: now,
		};
	}

	return {
		...clock,
		elapsedMs: targetDisplayMs,
		startedAt: clock.startedAt === null
			? null
			: now,
	};
}

// ──────────────── Clock Transitions ────────────────

/**
 * What an operator does to a Feature Match Session clock, each a pure function
 * of the clock and the server instant it happens at. The Session reducer and
 * the operator's optimistic update apply these same functions, so a prediction
 * cannot differ from the answer. Which a Session refuses is the reducer's rule.
 * A transition that changes nothing hands back the clock it was given.
 */
export const clockTransitions = {
	/** Run a stopped clock from `at`. A running clock keeps the start it has. */
	start(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return clock.startedAt === null
			? { ...clock, startedAt: at }
			: clock;
	},

	/** Stop a running clock, keeping the time it has run by `at`. */
	pause(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return clock.startedAt === null
			? clock
			: {
					...clock,
					elapsedMs: getEffectiveElapsedMs(clock, at),
					startedAt: null,
				};
	},

	/** Stop the clock with no time run, at a new duration if one is given. */
	reset(clock: FeatureMatchClock, durationMs?: number): FeatureMatchClock {
		return {
			...clock,
			elapsedMs: 0,
			startedAt: null,
			...(durationMs !== undefined && { durationMs }),
		};
	},

	/** Run the clock from `at` with no time run, whether or not it was running. */
	restart(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return {
			...clock,
			elapsedMs: 0,
			startedAt: at,
		};
	},

	/** Move what the clock shows by `deltaMs`, as `applyClockAdjustment` does. */
	adjust(clock: FeatureMatchClock, at: number, deltaMs: number): FeatureMatchClock {
		return applyClockAdjustment(clock, at, { deltaDisplayMs: deltaMs });
	},

	/** Set what the clock shows to `targetMs`, as `applyClockAdjustment` does. */
	set(clock: FeatureMatchClock, at: number, targetMs: number): FeatureMatchClock {
		return applyClockAdjustment(clock, at, { targetDisplayMs: targetMs });
	},
};
