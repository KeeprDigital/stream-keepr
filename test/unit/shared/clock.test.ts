import type { ClockState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import {
	applyClockAdjustment,
	formatClockTime,
	getEffectiveElapsedMs,
	normalizeTimeInput,
	parseTimeInput,
} from '~~/shared/utils/clock';

// ──────────────── formatClockTime ────────────────

describe('formatClockTime', () => {
	it('formats zero milliseconds as 0:00', () => {
		expect(formatClockTime(0)).toBe('0:00');
	});

	it('formats seconds only', () => {
		expect(formatClockTime(30_000)).toBe('0:30');
	});

	it('formats minutes and seconds', () => {
		expect(formatClockTime(150_000)).toBe('2:30');
	});

	it('pads seconds with leading zero', () => {
		expect(formatClockTime(61_000)).toBe('1:01');
	});

	it('formats hours when total exceeds 60 minutes', () => {
		expect(formatClockTime(3_661_000)).toBe('1:01:01');
	});

	it('pads minutes with leading zero in hour format', () => {
		expect(formatClockTime(3_600_000)).toBe('1:00:00');
	});

	it('ignores sub-second precision (floors)', () => {
		expect(formatClockTime(1_999)).toBe('0:01');
	});
});

// ──────────────── normalizeTimeInput ────────────────

describe('normalizeTimeInput', () => {
	it('returns null for empty string', () => {
		expect(normalizeTimeInput('')).toBeNull();
	});

	it('returns null for whitespace only', () => {
		expect(normalizeTimeInput('   ')).toBeNull();
	});

	it('passes through valid mm:ss format', () => {
		expect(normalizeTimeInput('12:34')).toBe('12:34');
	});

	it('passes through valid h:mm:ss format', () => {
		expect(normalizeTimeInput('1:23:45')).toBe('1:23:45');
	});

	// Digit-only input by length
	it('interprets 1 digit as minutes (e.g. "5" -> "5:00")', () => {
		expect(normalizeTimeInput('5')).toBe('5:00');
	});

	it('interprets 2 digits as minutes (e.g. "45" -> "45:00")', () => {
		expect(normalizeTimeInput('45')).toBe('45:00');
	});

	it('interprets 3 digits as m:ss (e.g. "530" -> "05:30")', () => {
		expect(normalizeTimeInput('530')).toBe('05:30');
	});

	it('interprets 4 digits as mm:ss (e.g. "1234" -> "12:34")', () => {
		expect(normalizeTimeInput('1234')).toBe('12:34');
	});

	it('interprets 5 digits as h:mm:ss (e.g. "12345" -> "1:23:45")', () => {
		expect(normalizeTimeInput('12345')).toBe('1:23:45');
	});

	it('interprets 6 digits as hh:mm:ss (e.g. "123456" -> "12:34:56")', () => {
		expect(normalizeTimeInput('123456')).toBe('12:34:56');
	});

	it('returns null for 7+ digits', () => {
		expect(normalizeTimeInput('1234567')).toBeNull();
	});

	it('strips non-digit characters from numeric input', () => {
		expect(normalizeTimeInput('12.34')).toBe('12:34');
	});

	it('rejects colon-form seconds of 60 or more', () => {
		expect(normalizeTimeInput('5:99')).toBeNull();
		expect(normalizeTimeInput('5:60')).toBeNull();
		expect(normalizeTimeInput('1:23:99')).toBeNull();
	});

	it('rejects colon-form minutes of 60 or more when hours are present', () => {
		expect(normalizeTimeInput('1:99:00')).toBeNull();
		expect(normalizeTimeInput('1:60:00')).toBeNull();
	});

	it('still allows mm:ss minutes above 59 (no hours field to overflow into)', () => {
		expect(normalizeTimeInput('75:00')).toBe('75:00');
	});
});

// ──────────────── normalize/parse agreement ────────────────

describe('normalizeTimeInput and parseTimeInput agree', () => {
	it('accepts every string normalizeTimeInput returns as canonical', () => {
		const inputs: string[] = [
			'5:',
			':5',
			'5::5',
			' 12:34 ',
			'0:00',
			'00:00',
			'005:009',
			'abc',
			'5.99',
			'1:23:45:67',
			'99999999999999999999:00',
		];
		for (let minutes = 0; minutes <= 70; minutes += 1) {
			for (let seconds = 0; seconds <= 70; seconds += 7) {
				inputs.push(`${minutes}:${seconds}`);
				inputs.push(`${minutes}:${String(seconds).padStart(2, '0')}`);
			}
		}
		for (const hours of [0, 1, 12, 99]) {
			for (let minutes = 0; minutes <= 70; minutes += 7) {
				for (let seconds = 0; seconds <= 70; seconds += 7) {
					inputs.push(`${hours}:${minutes}:${seconds}`);
				}
			}
		}
		for (const digits of ['0', '9', '59', '60', '99', '099', '559', '599', '1234', '1299', '5999', '12345', '19999', '123456', '129999', '1234567']) {
			inputs.push(digits);
		}

		for (const input of inputs) {
			const normalized = normalizeTimeInput(input);
			if (normalized !== null) {
				expect(parseTimeInput(normalized), `normalizeTimeInput(${JSON.stringify(input)}) -> ${JSON.stringify(normalized)} must be parseable`).not.toBeNull();
			}
		}
	});
});

// ──────────────── parseTimeInput ────────────────

describe('parseTimeInput', () => {
	it('returns null for empty input', () => {
		expect(parseTimeInput('')).toBeNull();
	});

	it('parses mm:ss to milliseconds', () => {
		expect(parseTimeInput('2:30')).toBe(150_000);
	});

	it('parses h:mm:ss to milliseconds', () => {
		expect(parseTimeInput('1:00:00')).toBe(3_600_000);
	});

	it('parses digit-only input via normalization', () => {
		expect(parseTimeInput('45')).toBe(2_700_000); // 45:00
	});

	it('returns null for invalid input', () => {
		expect(parseTimeInput('abc')).toBeNull();
	});
});

// ──────────────── getEffectiveElapsedMs ────────────────

describe('getEffectiveElapsedMs', () => {
	it('returns elapsedMs when clock is stopped', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(60_000);
	});

	it('adds running time when clock is running', () => {
		const now = 1_000_000;
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: true,
			lastStartedAt: now - 10_000,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, now)).toBe(70_000);
	});

	it('returns 0 minimum (never negative)', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: -100,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(0);
	});
});

// ──────────────── applyClockAdjustment ────────────────

describe('applyClockAdjustment', () => {
	const now = 1_000_000;

	it('adjusts countdown clock by delta', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 30_000 });

		// Display was 240000 (300000-60000), add 30000 = 270000 display
		// New durationMs = elapsedMs + targetDisplayMs = 60000 + 270000 = 330000
		expect(result.durationMs).toBe(330_000);
		expect(result.elapsedMs).toBe(60_000);
	});

	it('adjusts countup clock by delta', () => {
		const clock: ClockState = {
			type: 'countup',
			durationMs: 0,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.elapsedMs).toBe(70_000);
	});

	it('sets countdown clock to absolute target', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: 200_000 });
		expect(result.durationMs).toBe(260_000); // 60000 + 200000
	});

	it('clamps display to zero minimum', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: -100 });
		expect(result.durationMs).toBe(60_000); // elapsedMs + 0
	});

	it('updates lastStartedAt when clock is running', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: true,
			lastStartedAt: now - 5_000,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.lastStartedAt).toBe(now);
		expect(result.isRunning).toBe(true);
	});
});
