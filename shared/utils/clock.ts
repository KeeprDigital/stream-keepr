import type { ClockState } from '../types/featureMatchState';

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

export function getEffectiveElapsedMs(clock: ClockState, now: number): number {
	let elapsedMs = clock.elapsedMs;

	if (clock.isRunning && clock.lastStartedAt) {
		elapsedMs += now - clock.lastStartedAt;
	}

	return Math.max(0, elapsedMs);
}

/**
 * What a Feature Match Session clock shows at `now`: the remaining time of a
 * countdown, its overtime once expired if it counts up after (holding at its
 * count-up limit, if it has one), the elapsed time
 * otherwise, and the Event's Untimed Label for an untimed clock. No clock reads
 * `0:00`. Whether a blank Untimed Label hides the clock is the caller's to decide.
 * Time remaining rounds up; elapsed time and overtime round down (ADR-0078).
 */
export function formatClockDisplay(clock: ClockState | null, now: number, untimedLabel: string): string {
	if (!clock)
		return '0:00';
	if (clock.type === 'untimed')
		return untimedLabel.trim();

	const elapsedMs = getEffectiveElapsedMs(clock, now);
	if (clock.type === 'countdown') {
		if (clock.countUpAfterCountdown && elapsedMs >= clock.durationMs)
			return formatClockTime(countUpOvertimeMs(elapsedMs - clock.durationMs, clock.countUpLimitMs));
		return formatCountdownTime(clock.durationMs - elapsedMs);
	}
	return formatClockTime(elapsedMs);
}

/**
 * How long from `now` until what `formatClockDisplay` shows next changes, or
 * `null` while it will not: no clock, untimed, stopped, run out without counting
 * up, or holding at its count-up limit. Time counting up rounds down and time
 * remaining rounds up, so each changes on the whole second, and a countdown's
 * last second ends at its end.
 */
export function clockDisplayNextChangeInMs(clock: ClockState | null, now: number): number | null {
	if (!clock || clock.type === 'untimed' || !clock.isRunning || !clock.lastStartedAt)
		return null;

	const elapsedMs = getEffectiveElapsedMs(clock, now);
	if (clock.type !== 'countdown')
		return 1000 - (elapsedMs % 1000);

	const remainingMs = clock.durationMs - elapsedMs;
	if (remainingMs > 0)
		return countdownNextChangeInMs(remainingMs);
	if (!clock.countUpAfterCountdown)
		return null;
	const overMs = -remainingMs;
	return clock.countUpLimitMs != null && overMs >= clock.countUpLimitMs
		? null
		: 1000 - (overMs % 1000);
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
	clock: ClockState,
	now: number,
	adjustment: ClockAdjustmentInput,
): ClockState {
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
			lastStartedAt: clock.isRunning ? now : null,
		};
	}

	return {
		...clock,
		elapsedMs: targetDisplayMs,
		lastStartedAt: clock.isRunning ? now : null,
	};
}
